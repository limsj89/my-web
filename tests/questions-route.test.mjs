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

function setup({
  valid = true,
  dbError = false,
  rows = [{ id: 7, question: "hello", created_at: "2026-09-06" }],
} = {}) {
  const calls = { clients: [], tokens: [], inserts: [], queries: [] }
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
        from(table) {
          // Postgrest 쿼리빌더처럼 체이닝을 기록하고 마지막에 await 된다.
          const query = {
            table, clientKey: key, op: null, columns: null,
            filters: [], ordering: null, isSingle: false,
            insert(row) { query.op = "insert"; calls.inserts.push(row); return query },
            delete() { query.op = "delete"; return query },
            select(columns) { query.columns = columns; return query },
            eq(column, value) { query.filters.push({ column, value }); return query },
            order(column, config) { query.ordering = { column, ascending: config?.ascending }; return query },
            async single() {
              query.isSingle = true
              return dbError
                ? { data: null, error: { message: "denied" } }
                : { data: { id: 7, created_at: "2026-09-06" }, error: null }
            },
            then(resolve) {
              resolve(dbError ? { data: null, error: { message: "denied" } } : { data: rows, error: null })
            },
          }
          calls.queries.push(query)
          return query
        },
      }
    } }),
  }
  vm.runInNewContext(source, context)
  return { api: context.exports, calls }
}

function postRequest(authorization, body = JSON.stringify({ question: "hello" })) {
  return new Request("http://localhost/api/questions", {
    method: "POST", body,
    headers: authorization ? { Authorization: authorization } : {},
  })
}

function getRequest(authorization, search = "") {
  return new Request(`http://localhost/api/questions${search}`, {
    method: "GET",
    headers: authorization ? { Authorization: authorization } : {},
  })
}

function deleteRequest(authorization, search = "?id=7") {
  const request = new Request(`http://localhost/api/questions${search}`, {
    method: "DELETE",
    headers: authorization ? { Authorization: authorization } : {},
  })
  // NextRequest는 Request에 nextUrl을 더한 형태다. 핸들러는 헤더와 nextUrl만 쓴다.
  return Object.assign(request, { nextUrl: new URL(request.url) })
}

// 인증 없이 또는 형식이 틀린 헤더로 보내는 요청에 쓰는 공통 값.
const BAD_HEADERS = [undefined, "Basic abc", "Bearer", "Bearer a b"]

test("missing/malformed credentials return 401 before any DB access", async () => {
  for (const header of BAD_HEADERS) {
    const { api, calls } = setup()
    assert.equal((await api.POST(postRequest(header))).status, 401)
    assert.equal(calls.clients.length, 0)
  }
})

test("rejected JWT returns 401 without inserting", async () => {
  const { api, calls } = setup({ valid: false })
  assert.equal((await api.POST(postRequest("Bearer invalid"))).status, 401)
  assert.deepEqual(calls.tokens, ["invalid"])
  assert.equal(calls.inserts.length, 0)
})

test("POST verifies JWT with publishable key, then saves verified identity with server key", async () => {
  const { api, calls } = setup()
  const response = await api.POST(postRequest("Bearer user-token", JSON.stringify({
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
    assert.equal((await api.POST(postRequest("Bearer user-token", body))).status, 400)
    assert.equal(calls.inserts.length, 0)
  }
})

test("insert failures return 500", async () => {
  const { api } = setup({ dbError: true })
  assert.equal((await api.POST(postRequest("Bearer user-token"))).status, 500)
})

test("GET without a bearer token returns 401 before touching Supabase", async () => {
  for (const header of BAD_HEADERS) {
    const { api, calls } = setup()
    const response = await api.GET(getRequest(header))
    assert.equal(response.status, 401)
    assert.equal(calls.clients.length, 0)
    assert.equal(calls.queries.length, 0)
  }
})

test("GET with a rejected token returns 401 without querying", async () => {
  const { api, calls } = setup({ valid: false })
  assert.equal((await api.GET(getRequest("Bearer invalid"))).status, 401)
  assert.deepEqual(calls.tokens, ["invalid"])
  assert.equal(calls.queries.length, 0)
})

test("GET reads only the verified user's rows, newest first, with the server key", async () => {
  const { api, calls } = setup()
  const response = await api.GET(getRequest("Bearer user-token"))
  assert.equal(response.status, 200)

  const body = await response.json()
  assert.equal(body.success, true)
  assert.deepEqual(body.questions, [{ id: 7, question: "hello", created_at: "2026-09-06" }])
  // 사용자별 응답이므로 캐시에 남기지 않는다.
  assert.equal(response.headers.get("cache-control"), "no-store")

  // 토큰 확인은 publishable key, 조회는 secret key.
  assert.deepEqual(calls.clients.map(client => client.key), ["publishable", "server-secret"])
  assert.deepEqual(calls.tokens, ["user-token"])

  const [query] = calls.queries
  assert.equal(query.table, "questions")
  assert.equal(query.clientKey, "server-secret")
  assert.equal(query.columns, "id, question, created_at")
  assert.deepEqual(query.filters, [{ column: "user_id", value: "verified-user" }])
  assert.deepEqual(query.ordering, { column: "created_at", ascending: false })
})

test("GET ignores any user_id the browser tries to supply", async () => {
  const { api, calls } = setup()
  const response = await api.GET(getRequest("Bearer user-token", "?user_id=forged-user&userId=forged-user"))
  assert.equal(response.status, 200)
  assert.deepEqual(calls.queries[0].filters, [{ column: "user_id", value: "verified-user" }])
})

test("GET reports database failures as 500", async () => {
  const { api } = setup({ dbError: true })
  assert.equal((await api.GET(getRequest("Bearer user-token"))).status, 500)
})

test("DELETE without a bearer token returns 401 before touching Supabase", async () => {
  for (const header of BAD_HEADERS) {
    const { api, calls } = setup()
    const response = await api.DELETE(deleteRequest(header))
    assert.equal(response.status, 401)
    assert.equal(calls.clients.length, 0)
    assert.equal(calls.queries.length, 0)
  }
})

test("DELETE with a rejected token returns 401 without deleting", async () => {
  const { api, calls } = setup({ valid: false })
  assert.equal((await api.DELETE(deleteRequest("Bearer invalid"))).status, 401)
  assert.deepEqual(calls.tokens, ["invalid"])
  assert.equal(calls.queries.length, 0)
})

test("DELETE removes only the row matching id and the verified user", async () => {
  const { api, calls } = setup()
  const response = await api.DELETE(deleteRequest("Bearer user-token"))
  assert.equal(response.status, 200)
  assert.equal((await response.json()).id, 7)

  // 토큰 확인은 publishable key, 삭제는 secret key.
  assert.deepEqual(calls.clients.map(client => client.key), ["publishable", "server-secret"])

  const deletes = calls.queries.filter(query => query.op === "delete")
  assert.equal(deletes.length, 1)
  assert.equal(deletes[0].table, "questions")
  assert.equal(deletes[0].clientKey, "server-secret")
  assert.deepEqual(deletes[0].filters, [
    { column: "id", value: 7 },
    { column: "user_id", value: "verified-user" },
  ])
})

test("DELETE cannot touch another user's question", async () => {
  // 다른 사용자의 질문이면 (id, user_id) 조건에 맞는 행이 없어서 0건이 반환된다.
  const { api, calls } = setup({ rows: [] })
  const response = await api.DELETE(deleteRequest("Bearer user-token", "?id=999"))
  assert.equal(response.status, 404)
  assert.deepEqual(calls.queries[0].filters, [
    { column: "id", value: 999 },
    { column: "user_id", value: "verified-user" },
  ])
})

test("DELETE rejects malformed ids with 400 only after login is confirmed", async () => {
  for (const search of ["", "?id=abc", "?id=0", "?id=-1", "?id=1.5"]) {
    const { api, calls } = setup()
    const response = await api.DELETE(deleteRequest("Bearer user-token", search))
    assert.equal(response.status, 400)
    assert.deepEqual(calls.tokens, ["user-token"])
    assert.equal(calls.queries.length, 0)
  }
})

test("no response body leaks the server secret key", async () => {
  const { api } = setup({ valid: false, dbError: true })
  const responses = [
    await api.GET(getRequest(undefined)),
    await api.GET(getRequest("Bearer invalid")),
    await api.GET(getRequest("Bearer user-token")),
    await api.POST(postRequest("Bearer invalid")),
    await api.DELETE(deleteRequest(undefined)),
    await api.DELETE(deleteRequest("Bearer invalid")),
  ]
  for (const response of responses) {
    assert.doesNotMatch(JSON.stringify(await response.json()), /server-secret/)
  }
})