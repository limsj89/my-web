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

// GET /api/questions
// 저장된 질문 목록을 최신순으로 돌려준다. Supabase에는 서버만 접속한다.
export async function GET() {
  try {
    const supabase = createAdminClient()

    // id, question, created_at을 조회하고 생성 시간 내림차순(최신이 위)으로 정렬한다.
    const { data, error } = await supabase
      .from("questions")
      .select("id, question, created_at")
      .order("created_at", { ascending: false })

    if (error) {
      // 상세 내용은 서버 로그에만 남기고 사용자에게는 간단한 메시지만 보낸다
      console.error("Supabase 조회 실패:", error.message)
      return Response.json(
        { success: false, error: "질문 목록을 불러오지 못했습니다." },
        { status: 500 },
      )
    }

    // Cache-Control: no-store
    // 브라우저가 이전 응답을 보관해서 방금 저장한 질문이 안 보이는 일을 막는다.
    return Response.json(
      { success: true, questions: data ?? [] },
      { headers: { "Cache-Control": "no-store" } },
    )
  } catch (error) {
    console.error("질문 목록 조회 중 오류:", error)
    return Response.json(
      { success: false, error: "질문 목록을 불러오지 못했습니다." },
      { status: 500 },
    )
  }
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

// DELETE /api/questions?id=123
// 지정한 한 행만 지운다. 지워진 행을 되받아 실제로 삭제됐는지 확인한다.
export async function DELETE(request: NextRequest) {
  // URL 쿼리문(?id=123)에서 id를 꺼낸다.
  // 숫자가 아니거나 0 이하이면 어떤 행도 지우지 않도록 바로 막는다.
  const idText = request.nextUrl.searchParams.get("id")
  const id = Number(idText)

  if (idText === null || !Number.isInteger(id) || id < 1) {
    return Response.json(
      { success: false, error: "삭제할 질문 id가 올바르지 않습니다." },
      { status: 400 },
    )
  }

  try {
    const supabase = createAdminClient()

    // .eq("id", id)로 해당 행만 지운다. 조건 없이 delete()를 부르면 전체가 사라진다.
    // .select("id")를 붙이면 지워진 행이 반환되어 실제로 지워졌는지 확인할 수 있다.
    const { data, error } = await supabase
      .from("questions")
      .delete()
      .eq("id", id)
      .select("id")

    if (error) {
      console.error("Supabase 삭제 실패:", error.message)
      return Response.json(
        { success: false, error: "질문 삭제에 실패했습니다." },
        { status: 500 },
      )
    }

    // 지워진 행이 없으면 id가 존재하지 않았다는 뜻이다.
    if (!data || data.length === 0) {
      return Response.json(
        { success: false, error: "삭제할 질문을 찾지 못했습니다." },
        { status: 404 },
      )
    }

    return Response.json({
      success: true,
      message: "삭제되었습니다.",
      id: data[0].id,
    })
  } catch (error) {
    console.error("질문 삭제 중 오류:", error)
    return Response.json(
      { success: false, error: "질문 삭제 중 오류가 발생했습니다." },
      { status: 500 },
    )
  }
}
