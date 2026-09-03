"use client"

import { useState } from "react"

export default function Home() {
  // textarea에 입력한 질문을 담는 상태
  const [question, setQuestion] = useState("")

  // 질문하기 버튼을 눌렀을 때 보여줄 답변
  const [answer, setAnswer] = useState("")

  // 지금까지 질문한 목록. 최신 질문이 맨 위에 온다.
  const [history, setHistory] = useState<string[]>([])

  // 아직 API는 연결하지 않았다. 입력한 질문을 그대로 답변으로 표시한다.
  function handleAskClick() {
    const asked = question.trim()
    setAnswer(asked)
    setHistory([asked, ...history])
  }

  // x 버튼을 누르면 해당 질문만 목록에서 지운다.
  function handleDeleteClick(index: number) {
    setHistory(history.filter((_, i) => i !== index))
  }

  return (
    <main className="flex-1 w-full max-w-2xl mx-auto px-4 py-12 flex flex-col gap-8">
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

        <button
          type="button"
          onClick={handleAskClick}
          disabled={question.trim() === ""}
          className="self-start rounded-lg bg-neutral-900 px-5 py-2.5 text-base font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
        >
          질문하기
        </button>
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
        <h2 className="text-sm font-medium">지난 질문</h2>

        {history.length === 0 ? (
          <p className="text-base text-neutral-400">지난 질문이 없습니다.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {history.map((pastQuestion, index) => (
              <li
                key={index}
                className="flex items-center gap-2 rounded-lg border border-neutral-300 p-2 dark:border-neutral-700"
              >
                {/* 질문을 누르면 그 질문이 답변 영역에 다시 표시된다 */}
                <button
                  type="button"
                  onClick={() => setAnswer(pastQuestion)}
                  title={pastQuestion}
                  className="flex-1 min-w-0 truncate text-left text-base hover:underline"
                >
                  {pastQuestion}
                </button>

                <button
                  type="button"
                  onClick={() => handleDeleteClick(index)}
                  title="이 질문 삭제"
                  aria-label="이 질문 삭제"
                  className="shrink-0 rounded-md px-2.5 py-1 text-base font-medium text-neutral-500 hover:bg-neutral-200 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                >
                  x
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}