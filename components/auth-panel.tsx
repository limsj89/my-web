"use client"

import { useEffect, useState, type FormEvent } from "react"
import { getSupabaseBrowserClient } from "@/lib/supabase-browser"

type AuthStatus = { kind: "success" | "error"; message: string } | null

// 상태 확인 중인지, 로그인 전인지, 로그인 후인지 구분한다.
type AuthState = "checking" | "signedOut" | "signedIn"

// 입력값이 형식에 맞는지 먼저 확인한다.
function isEmailLike(value: string): boolean {
  return value.includes("@")
}

export default function AuthPanel() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [authState, setAuthState] = useState<AuthState>("checking")
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null)
  const [status, setStatus] = useState<AuthStatus>(null)
  const [isPending, setIsPending] = useState(false)

  // 처음 화면에 들어왔을 때(그리고 새로고침 후) 저장된 세션을 확인한다.
  // 그 뒤에 로그인/로그아웃이 일어나면 구독으로 상태를 갱신한다.
  useEffect(() => {
    const supabase = getSupabaseBrowserClient()
    let isMounted = true

    void supabase.auth.getSession().then(({ data }) => {
      if (!isMounted) return
      const session = data.session
      setAuthState(session ? "signedIn" : "signedOut")
      setSignedInEmail(session?.user.email ?? null)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthState(session ? "signedIn" : "signedOut")
      setSignedInEmail(session?.user.email ?? null)
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [])

  // 회원가입과 로그인은 같은 폼과 같은 결과 처리 흐름을 공유한다.
  async function runAuth(mode: "signup" | "signin") {
    const trimmedEmail = email.trim()
    setStatus(null)

    if (!isEmailLike(trimmedEmail) || password === "") {
      setStatus({ kind: "error", message: "이메일과 비밀번호를 입력해 주세요." })
      return
    }

    setIsPending(true)

    try {
      const supabase = getSupabaseBrowserClient()
      const { data, error } =
        mode === "signup"
          ? await supabase.auth.signUp({ email: trimmedEmail, password })
          : await supabase.auth.signInWithPassword({ email: trimmedEmail, password })

      if (error) {
        setStatus({ kind: "error", message: error.message })
        return
      }

      if (mode === "signup") {
        // 이메일 인증 설정이 켜져 있으면 세션이 바로 생기지 않는다.
        if (data.session === null) {
          setStatus({
            kind: "success",
            message: "가입 완료: 메일의 인증 링크를 눌러 주세요.",
          })
          setPassword("")
        } else {
          setStatus({ kind: "success", message: "회원가입되었습니다." })
        }
        return
      }

      setStatus({ kind: "success", message: "로그인되었습니다." })
    } catch (error) {
      setStatus({
        kind: "error",
        message:
          error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.",
      })
    } finally {
      setIsPending(false)
    }
  }

  async function handleSignOut() {
    setStatus(null)
    setIsPending(true)

    try {
      const { error } = await getSupabaseBrowserClient().auth.signOut()
      if (error) setStatus({ kind: "error", message: error.message })
    } catch (error) {
      setStatus({
        kind: "error",
        message:
          error instanceof Error ? error.message : "로그아웃에 실패했습니다.",
      })
    } finally {
      setIsPending(false)
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // Enter 키 입력은 로그인으로 처리한다.
    void runAuth("signin")
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-neutral-300 p-4 dark:border-neutral-700">
      <h2 className="text-sm font-medium">계정</h2>

      {/* 결과를 알려주는 문구 */}
      <p
        role="status"
        aria-live="polite"
        className={`text-sm ${
          status === null
            ? "hidden"
            : status.kind === "success"
              ? "text-green-700 dark:text-green-400"
              : "text-red-600 dark:text-red-400"
        }`}
      >
        {status?.message}
      </p>

      {/* 세션 확인 중 */}
      {authState === "checking" ? (
        <p className="text-base text-neutral-400">로그인 상태 확인 중...</p>
      ) : null}

      {/* 로그인 전: 이메일/비밀번호 입력 폼 */}
      {authState === "signedOut" ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event: FormEvent<HTMLFormElement>) =>
            void handleSubmit(event)
          }
        >
          <label htmlFor="auth-email" className="text-sm font-medium">
            이메일
          </label>

          <input
            id="auth-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-lg border border-neutral-300 bg-background p-2.5 text-base text-foreground placeholder:text-neutral-400 focus:border-neutral-900 focus:outline-none dark:border-neutral-700 dark:focus:border-neutral-100"
          />

          <label htmlFor="auth-password" className="text-sm font-medium">
            비밀번호
          </label>

          <input
            id="auth-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="6자 이상"
            className="w-full rounded-lg border border-neutral-300 bg-background p-2.5 text-base text-foreground placeholder:text-neutral-400 focus:border-neutral-900 focus:outline-none dark:border-neutral-700 dark:focus:border-neutral-100"
          />

          <div className="flex flex-wrap gap-2">
            {/* 회원가입 버튼은 submit 없이 동작만 지정한다 */}
            <button
              type="button"
              onClick={() => void runAuth("signup")}
              disabled={isPending}
              className="rounded-lg border border-neutral-300 px-5 py-2.5 text-base font-medium hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              회원가입
            </button>

            <button
              type="submit"
              disabled={isPending}
              className="rounded-lg bg-neutral-900 px-5 py-2.5 text-base font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
            >
              {isPending ? "처리 중..." : "로그인"}
            </button>
          </div>
        </form>
      ) : null}

      {/* 로그인 후: 이메일과 로그아웃 버튼 */}
      {authState === "signedIn" ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-base break-all">
            로그인 중: <span className="font-medium">{signedInEmail}</span>
          </p>

          <button
            type="button"
            onClick={() => void handleSignOut()}
            disabled={isPending}
            className="ml-auto rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            로그아웃
          </button>
        </div>
      ) : null}
    </section>
  )
}
