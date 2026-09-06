"use client"

import { useCallback, useEffect, useState, useSyncExternalStore } from "react"
import AuthPanel from "@/components/auth-panel"
import { getSupabaseBrowserClient } from "@/lib/supabase-browser"

// 화면 위에 보여줄 저장 결과. 아직 결과를 받지 못하면 null이다.
type SaveStatus = { kind: "success" | "error"; message: string } | null

// Supabase questions 테이블에서 받아오는 질문 한 건
type SavedQuestion = {
  id: number
  question: string
  created_at: string
}

// 목록 불러오기에 실패했을 때 보여줄 기본 메시지
const LIST_LOAD_ERROR = "질문 목록을 불러오지 못했습니다."

// 로그아웃 상태에서 목록 영역에 보여줄 안내 문구
const LOGIN_REQUIRED = "저장한 질문을 보려면 로그인해 주세요."

// 서버와 hydration 첫 렌더링은 false, hydration 이후 브라우저에서는 true.
// 구독할 외부 데이터는 없으며 브라우저 저장소나 세션을 읽지 않는다.
const subscribeToMount = () => () => {}
const getMountedSnapshot = () => true
const getServerMountedSnapshot = () => false

// 서버(/api/questions)에서 저장된 질문 목록을 받아온다.
// 서버는 Bearer 토큰으로 호출자를 확인하므로 로그인 사용자의 access_token을 함께 보낸다.
// 상태를 건드리지 않는 순수한 네트워크 함수이며, 실패하면 예외를 던진다.
async function fetchSavedQuestions(accessToken: string): Promise<SavedQuestion[]> {
  const response = await fetch("/api/questions", {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  // 응답이 JSON이 아닐 수도 있어서 안전하게 해석한다.
  const result = (await response.json().catch(() => null)) as {
    questions?: SavedQuestion[]
    error?: string
  } | null

  if (!response.ok || !Array.isArray(result?.questions)) {
    throw new Error(result?.error ?? LIST_LOAD_ERROR)
  }

  return result.questions
}

// 예외에서 사용자용 메시지 문자열을 꺼낸다.
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : LIST_LOAD_ERROR
}

// DB가 준 시간 문자열("2026-09-06T15:23:01+00:00")을 보기 좋은 날짜/시간으로 바꾼다.
function formatCreatedAt(value: string): string {
  const date = new Date(value)

  // 형식이 이상하면 원본 문자열을 그대로 보여준다.
  if (Number.isNaN(date.getTime())) return value

  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}

export default function Home() {
  const mounted = useSyncExternalStore(
    subscribeToMount,
    getMountedSnapshot,
    getServerMountedSnapshot,
  )

  // textarea에 입력한 질문을 담는 상태
  const [question, setQuestion] = useState("")

  // 질문하기 버튼을 눌렀을 때 보여줄 답변
  const [answer, setAnswer] = useState("")

  // 서버 저장 결과 메시지("저장되었습니다." 또는 오류 메시지)
  const [status, setStatus] = useState<SaveStatus>(null)

  // 저장 요청 중에 버튼이 두 번 눌리지 않게 막는 플래그
  const [isSaving, setIsSaving] = useState(false)

  // 서버에서 불러온 저장된 질문 목록.
  // null은 아직 한 번도 불러오지 못한 상태이고, 이 경우 "불러오는 중"을 보여준다.
  const [savedQuestions, setSavedQuestions] = useState<SavedQuestion[] | null>(null)

  // 목록 불러오기에 실패했을 때의 오류 메시지
  const [listError, setListError] = useState<string | null>(null)

  // 삭제 요청 중인 질문 id.
  // 값이 있는 동안에는 모든 삭제 버튼을 비활성화해 중복 요청을 막는다.
  const [deletingId, setDeletingId] = useState<number | null>(null)

  // 삭제에 실패했을 때의 오류 메시지
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // 저장된 질문 목록을 다시 불러온다.
  // 저장 성공 직후와 "다시 시도" 버튼에서 함께 사용한다.
  // useCallback으로 감싸면 함수가 매번 새로 만들어지지 않으므로
  // useEffect 의존성 배열에 넣어도 무한 반복이 생기지 않는다.
  const refreshQuestions = useCallback(async () => {
    try {
      // 서버가 호출자를 확인할 수 있도록 현재 세션의 토큰부터 가져온다.
      const { data, error } = await getSupabaseBrowserClient().auth.getSession()
      const accessToken = error ? null : data.session?.access_token

      // 로그아웃 상태에서는 요청해도 401만 나오므로 목록 요청 없이 안내만 보여준다.
      if (!accessToken) {
        setSavedQuestions(null)
        setListError(LOGIN_REQUIRED)
        return
      }

      const items = await fetchSavedQuestions(accessToken)
      setSavedQuestions(items)
      setListError(null)

      // 목록이 방금 서버 상태를 반영했으므로 이전 삭제 오류 메시지는 지운다.
      setDeleteError(null)
    } catch (error) {
      // 저장 자체는 성공했을 수 있으므로 오류는 목록 영역에만 표시한다.
      setListError(messageOf(error))
    }
  }, [])

  // 페이지가 열리면 한 번 목록을 불러온다.
  useEffect(() => {
    async function loadOnMount() {
      await refreshQuestions()
    }

    void loadOnMount()
  }, [refreshQuestions])

  // 로그인/로그아웃이 일어나면 목록을 그 사용자의 것으로 갈아끼운다.
  // 첫 화면 로드는 위의 마운트 useEffect가 담당하므로 INITIAL_SESSION은 건너뛴다.
  useEffect(() => {
    const {
      data: { subscription },
    } = getSupabaseBrowserClient().auth.onAuthStateChange((event, session) => {
      if (event === "INITIAL_SESSION") return

      if (session?.access_token) {
        void refreshQuestions()
      } else {
        // 로그아웃: 방금 전 사용자의 목록을 화면에 남겨두지 않는다.
        setSavedQuestions(null)
        setListError(LOGIN_REQUIRED)
      }
    })

    return () => subscription.unsubscribe()
  }, [refreshQuestions])

  // "다시 시도" 버튼. 오류 문구를 지우고 다시 불러온다.
  function handleRetryClick() {
    setListError(null)
    void refreshQuestions()
  }

  // 저장된 질문을 지운다. 확인 -> DELETE -> 목록 다시 불러오기 순서로 진행한다.
  async function handleSavedQuestionDelete(id: number) {
    // 브라우저 확인 창. "취소"를 누르면 아무것도 하지 않는다.
    if (!window.confirm("이 질문을 삭제할까요?")) return

    setDeletingId(id)
    setDeleteError(null)

    try {
      // 서버가 호출자를 확인할 수 있도록 현재 세션의 토큰을 함께 보낸다.
      const { data, error } = await getSupabaseBrowserClient().auth.getSession()
      const accessToken = error ? null : data.session?.access_token
      if (!accessToken) throw new Error("질문을 삭제하려면 로그인해 주세요.")

      // id는 URL 쿼리문으로 보낸다. 숫자이지만 혹시 모를 문자를 안전하게 인코딩한다.
      const response = await fetch(`/api/questions?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      // 응답이 JSON이 아닐 수도 있어서 안전하게 해석한다.
      const result = (await response.json().catch(() => null)) as {
        error?: string
      } | null

      if (!response.ok) {
        throw new Error(result?.error ?? "질문 삭제에 실패했습니다.")
      }

      // 지운 질문이 목록에서 바로 사라지도록 다시 불러온다.
      await refreshQuestions()
    } catch (error) {
      // 서버가 보내준 오류 메시지를 보여주고, fetch 실패는 한국어 안내로 바꾼다.
      const message =
        error instanceof TypeError
          ? "서버와 연결하지 못했습니다. 잠시 후 다시 시도해 주세요."
          : error instanceof Error
            ? error.message
            : "알 수 없는 오류가 발생했습니다."
      setDeleteError(message)
    } finally {
      setDeletingId(null)
    }
  }

  // 질문을 서버(/api/questions)로 보내 저장하고, 결과를 화면에 보여준다.
  async function handleAskClick() {
    const asked = question.trim()
    if (!mounted || isSaving || asked === "") return

    setIsSaving(true)
    setStatus(null)

    try {
      const { data, error } = await getSupabaseBrowserClient().auth.getSession()
      if (error || !data.session?.access_token) {
        throw new Error("질문을 저장하려면 로그인해 주세요.")
      }

      // 사용자 ID는 보내지 않고, 서버에서 검증할 세션 토큰만 전달한다.
      const response = await fetch("/api/questions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${data.session.access_token}`,
        },
        body: JSON.stringify({ question: asked }),
      })

      // 응답이 JSON이 아닐 수도 있어서 안전하게 해석한다.
      const result = (await response.json().catch(() => null)) as {
        error?: string
      } | null

      if (!response.ok) {
        throw new Error(result?.error ?? "질문 저장에 실패했습니다.")
      }

      setStatus({ kind: "success", message: "저장되었습니다." })

      // 답변 영역에 방금 저장한 질문을 보여준다.
      setAnswer(asked)

      // 방금 저장한 질문이 목록에 바로 보이도록 목록을 다시 불러온다.
      await refreshQuestions()
    } catch (error) {
      // 서버가 보내준 오류 메시지를 그대로 보여주고,
      // fetch 자체가 실패한 경우(서버 종료, 네트워크 끊김)는 한국어 안내로 바꾼다.
      const message =
        error instanceof TypeError
          ? "서버와 연결하지 못했습니다. 잠시 후 다시 시도해 주세요."
          : error instanceof Error
            ? error.message
            : "알 수 없는 오류가 발생했습니다."
      setStatus({ kind: "error", message })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <main className="flex-1 w-full max-w-2xl mx-auto px-4 py-12 flex flex-col gap-8">
      {/* 로그인/회원가입/로그아웃 UI (질문 CRUD와는 별도 영역) */}
      <AuthPanel />
      <h1 className="text-2xl font-bold">나의 첫 웹서비스</h1>

      <section className="flex flex-col gap-3">
        <label htmlFor="question" className="text-sm font-medium">
          질문을 입력해 주세요
        </label>

        <textarea
          id="question"
          rows={4}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="예) 자신을 소개해 주세요"
          className="w-full resize-y rounded-lg border border-neutral-300 bg-background p-3 text-base text-foreground placeholder:text-neutral-400 focus:border-neutral-900 focus:outline-none dark:border-neutral-700 dark:focus:border-neutral-100"
        />

        {/* hydration 전 disabled 속성 변경의 영향을 피하도록 실제 버튼은 마운트 후 생성한다. */}
        {mounted ? (
          <button
            type="button"
            onClick={handleAskClick}
            disabled={question.trim() === "" || isSaving}
            className="self-start rounded-lg bg-neutral-900 px-5 py-2.5 text-base font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
          >
            {isSaving ? "저장 중..." : "질문하기"}
          </button>
        ) : (
          <span
            aria-hidden="true"
            className="self-start cursor-not-allowed rounded-lg bg-neutral-900 px-5 py-2.5 text-base font-medium text-white opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
          >
            질문하기
          </span>
        )}

        {/* 저장 결과 메시지를 표시하는 영역 */}
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
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">답변</h2>

        <div className="min-h-28 w-full rounded-lg border border-neutral-300 p-3 dark:border-neutral-700">
          {answer === "" ? (
            <p className="text-base text-neutral-400">아직 답변이 없습니다.</p>
          ) : (
            <p className="whitespace-pre-wrap text-base">{answer}</p>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">저장된 질문</h2>

        {/* 삭제 실패 메시지를 표시하는 영역 */}
        <p
          role="status"
          aria-live="polite"
          className={`text-sm ${
            deleteError === null ? "hidden" : "text-red-600 dark:text-red-400"
          }`}
        >
          {deleteError}
        </p>

        {/*
          오류 -> 아직 못 불러옴(로딩) -> 목록 없음 -> 목록 순으로 보여준다.
          목록이 이미 있는 상태의 갱신은 로딩 문구 없이 그대로 갈아끼운다.
        */}
        {listError !== null ? (
          <div className="flex flex-col items-start gap-2">
            <p className="text-sm text-red-600 dark:text-red-400">{listError}</p>
            <button
              type="button"
              onClick={handleRetryClick}
              className="rounded-md border border-neutral-300 px-3 py-1 text-sm font-medium hover:bg-neutral-200 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              다시 시도
            </button>
          </div>
        ) : savedQuestions === null ? (
          <p className="text-base text-neutral-400">질문 목록을 불러오는 중...</p>
        ) : savedQuestions.length === 0 ? (
          <p className="text-base text-neutral-400">저장된 질문이 없습니다.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {savedQuestions.map((saved) => (
              <li
                key={saved.id}
                className="flex items-center gap-2 rounded-lg border border-neutral-300 p-2 dark:border-neutral-700"
              >
                {/* 왼쪽: 질문 내용과 생성 시간 */}
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <p className="break-words text-base">{saved.question}</p>
                  <p className="text-xs text-neutral-500">
                    {formatCreatedAt(saved.created_at)}
                  </p>
                </div>

                {/* 오른쪽: 삭제 버튼. 삭제 요청이 하나라도 진행 중이면 모두 비활성화 */}
                <button
                  type="button"
                  onClick={() => void handleSavedQuestionDelete(saved.id)}
                  disabled={deletingId !== null}
                  aria-label={`${saved.question} 삭제`}
                  className="shrink-0 self-center rounded-md px-2.5 py-1 text-base font-medium text-neutral-500 hover:bg-neutral-200 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                >
                  삭제
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
