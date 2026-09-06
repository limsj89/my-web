import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import vm from "node:vm"
import ts from "typescript"

// 실제 Auth/DB에 접근하지 않고 Route Handler의 인증 경계를 검사한다.
const source = ts.transpileModule(
  readFileSync(new URL("../app/api/questions/route.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText

function setup({ valid = true, dbError = false } = {}) {
  const calls = { clients: [], tokens: [], inserts: [], deletes: [] }
  const context = {
    exports: {}, Response,
    console: { error() {} },
    process: { env: {
      SUPABASE_URL: "https://admin.example.invalid",
      SUPABASE_SECRET_KEY: "server-secret",
      NEXT_PUBLIC_SUPABASE_URL: "https://user.example.invalid",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable",
    } },
    require: () => ({ createClient(url, key, options) {
      calls.clients.push({ url, key, options })
      return {
        auth: { async getUser(token) {
          calls.tokens.push(token)
          return valid
            ? { data: { user: { id: "verified-user" } }, error: null }
            : { data: { user: null }, error: { message: "Invalid JWT" } }
        } },
        from() {
          const query = {
            insert(row) { calls.inserts.push(row); return query },
            select() { return query },
            async single() {
              return dbError ? { data: null, error: { message: "denied" } }
                : { data: { id: 7, created_at: "2026-09-06" }, error: null }
            },
            async order() { return { data: [], error: null } },
            delete() { return query },
            eq(key, value) { calls.deletes.push({ key, value }); return query },
            then(resolve) { resolve({ data: [{ id: 7 }], error: null }) },
          }
          return query
        },
      }
    } }),
  }
  vm.runInNewContext(source, context)
  return { api: context.exports, calls }
}

function request(authorization, body = JSON.stringify({ question: "hello" })) {
  return new Request("http://localhost/api/questions", {
    method: "POST", body,
    headers: authorization ? { Authorization: authorization } : {},
  })
}

test("missing/malformed credentials return 401 before any DB access", async () => {
  for (const header of [undefined, "Basic abc", "Bearer", "Bearer a b"]) {
    const { api, calls } = setup()
    assert.equal((await api.POST(request(header))).status, 401)
    assert.equal(calls.clients.length, 0)
  }
})

test("rejected JWT returns 401 without inserting", async () => {
  const { api, calls } = setup({ valid: false })
  assert.equal((await api.POST(request("Bearer invalid"))).status, 401)
  assert.deepEqual(calls.tokens, ["invalid"])
  assert.equal(calls.inserts.length, 0)
})

test("POST verifies JWT with publishable key, then saves verified identity with server key", async () => {
  const { api, calls } = setup()
  const response = await api.POST(request("Bearer user-token", JSON.stringify({
    question: "  hello  ", user_id: "forged-user", id: 999,
  })))
  assert.equal(response.status, 200)
  assert.equal((await response.json()).id, 7)
  assert.deepEqual(JSON.parse(JSON.stringify(calls.inserts)), [{ question: "hello", user_id: "verified-user" }])
  assert.deepEqual(calls.tokens, ["user-token"])
  assert.equal(calls.clients[0].key, "publishable")
  assert.equal(calls.clients[0].options.global.headers.Authorization, "Bearer user-token")
  assert.equal(calls.clients[0].options.auth.persistSession, false)
  assert.equal(calls.clients.length, 2)
  assert.equal(calls.clients[1].key, "server-secret")
  assert.equal(calls.clients[1].options, undefined)
})

test("authenticated invalid input still returns 400 without inserting", async () => {
  for (const body of ["{", "{}", '{"question":" "}', '{"question":5}', JSON.stringify({ question: "x".repeat(1001) })]) {
    const { api, calls } = setup()
    assert.equal((await api.POST(request("Bearer user-token", body))).status, 400)
    assert.equal(calls.inserts.length, 0)
  }
})

test("insert failures return 500", async () => {
  const { api } = setup({ dbError: true })
  assert.equal((await api.POST(request("Bearer user-token"))).status, 500)
})

test("GET and DELETE keep their existing admin client behavior", async () => {
  const { api, calls } = setup()
  assert.equal((await api.GET()).status, 200)
  assert.equal((await api.DELETE({ nextUrl: new URL("http://localhost/api/questions?id=7") })).status, 200)
  assert.deepEqual(calls.clients.map(client => client.key), ["server-secret", "server-secret"])
  assert.deepEqual(calls.deletes, [{ key: "id", value: 7 }])
  assert.equal(calls.tokens.length, 0)
})
