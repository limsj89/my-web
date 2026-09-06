import { createClient, type SupabaseClient } from "@supabase/supabase-js"

// 브라우저(클라이언트) 전용 Supabase 클라이언트 파일.
//
// 여기서는 NEXT_PUBLIC_ 접두사가 붙은 값만 참조한다.
// 서버용 SUPABASE_URL / SUPABASE_SECRET_KEY는 이 파일에서 절대 읽지 않는다.
// (NEXT_PUBLIC_ 접두사가 없는 값은 클라이언트 번들에 인라인되지 않으므로,
//  이 파일이 브라우저로 번들되면_secret key_는 존재하지 않는 것과 같다.)

// 클라이언트는 1개만 만들어 재사용한다.
// 개발 모드 핫 리로드로 모듈이 다시 평가되어도 세션 저장소가 중복되지 않는다.
let cachedClient: SupabaseClient | null = null

export function getSupabaseBrowserClient(): SupabaseClient {
  if (cachedClient) return cachedClient

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

  // 값이 없으면 Supabase 요청이 의미 없으므로 이른 시점에 명확히 알려준다.
  if (!supabaseUrl || !publishableKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL 또는 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY가 .env.local에 설정되어야 합니다.",
    )
  }

  // 기본값(localStorage 세션 저장)을 그대로 사용하므로
  // 페이지를 새로고침해도 로그인이 유지된다.
  cachedClient = createClient(supabaseUrl, publishableKey)

  return cachedClient
}