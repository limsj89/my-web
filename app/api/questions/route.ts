import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import type { NextRequest } from "next/server"

// 지나치게 긴 입력을 막기 위한 제한
const MAX_QUESTION_LENGTH = 1000

// 서버 전용 Supabase 클라이언트를 만든다.
// SUPABASE_URL, SUPABASE_SECRET_KEY는 NEXT_PUBLIC_ 접두어가 없으므로
// 브라우저 번들에 들어가지 않고 이 파일(서버) 안에서만 쓰인다.
function createAdminClient(): SupabaseClient {
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY

  // 환경변수가 하나라도 없으면 Supabase에 접속할 수 없다.
  if (!supabaseUrl || !supabaseSecretKey) {
    throw new Error("SUPABASE_URL 또는 SUPABASE_SECRET_KEY 환경변수가 설정되지 않았습니다.")
  }

  return createClient(supabaseUrl, supabaseSecretKey)
}

// 요청 본문(아무 모양일 수 있다)에서 question 문자열만 안전하게 꺼낸다.
// question이 없거나 문자열이 아니면 null을 돌려준다.
function readQuestion(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null

  const value = (body as { question?: unknown }).question
  if (typeof value !== "string") return null

  return value.trim()
}

// POST /api/questions
// 브라우저는 이 주소로 질문을 보내고, Supabase에는 서버만 접속한다.
export async function POST(request: NextRequest) {
  // 1) 요청 본문(JSON) 해석
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json(
      { success: false, error: "요청 형식이 올바르지 않습니다." },
      { status: 400 },
    )
  }

  const question = readQuestion(body)

  // 2) 질문이 잘못된 경우 400 오류 반환
  if (question === null) {
    return Response.json(
      { success: false, error: "question에 문자열을 넣어 주세요." },
      { status: 400 },
    )
  }

  if (question === "") {
    return Response.json(
      { success: false, error: "질문을 입력해 주세요." },
      { status: 400 },
    )
  }

  if (question.length > MAX_QUESTION_LENGTH) {
    return Response.json(
      { success: false, error: `질문은 ${MAX_QUESTION_LENGTH}자 이하여야 합니다.` },
      { status: 400 },
    )
  }

  // 3) Supabase에 저장. id와 created_at은 DB 자동값을 쓰므로 question만 보낸다.
  try {
    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from("questions")
      .insert({ question })
      .select("id, created_at")
      .single()

    if (error || !data) {
      // 상세 내용은 서버 로그에만 남기고 사용자에게는 간단한 메시지만 보낸다
      console.error("Supabase 저장 실패:", error?.message)
      return Response.json(
        { success: false, error: "질문 저장에 실패했습니다." },
        { status: 500 },
      )
    }

    // 4) 성공 결과 반환
    return Response.json({
      success: true,
      message: "저장되었습니다.",
      id: data.id,
      createdAt: data.created_at,
    })
  } catch (error) {
    console.error("질문 저장 중 오류:", error)
    return Response.json(
      { success: false, error: "질문 저장 중 오류가 발생했습니다." },
      { status: 500 },
    )
  }
}