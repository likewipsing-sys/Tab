# 베이스 타브 노트

영상이나 음원에서 베이스만 뽑아, 주법까지 적힌 손글씨 타브 악보로 옮겨 적는 웹앱입니다. iPad Safari에서 바로 동작합니다.

## 구성
- `index.html` — 화면
- `app.js` — 앱 동작 (넥 보정, 분석 순서, 악보 그리기, 편집, 재생, Gemini, 내보내기)
- `core.js` — 신호 분석 엔진 (저음 필터, 킥 억제, 배음 합산 음정 추적, 주법 감지, 운지 배치, 원근 보정 계산)
- `engines.js` — 인터넷에서 불러오는 AI
  - Spotify Basic Pitch (음정 인식 AI)
  - Google MediaPipe (손 인식 AI)
  - Gemini API (사용자 키)

## iPad에서 GitHub Pages로 올리기
1. 받은 zip 파일을 **파일** 앱에서 탭해 압축을 풉니다.
2. Safari에서 github.com에 로그인 → 오른쪽 위 **+** → **New repository**
   - 이름: `bass-tab`
   - **Public** 선택 → **Create repository**
3. 새 저장소 화면에서 **uploading an existing file** 링크 → **choose your files**
   - 압축 푼 폴더 안의 파일을 모두 고릅니다: `index.html`, `app.js`, `core.js`, `engines.js`, `README.md`
   - **Commit changes**
4. 저장소 **Settings** → 왼쪽 **Pages**
   - Source: **Deploy from a branch**
   - Branch: **main** / **/(root)** → **Save**
5. 1~2분 뒤 `https://<내 아이디>.github.io/bass-tab/` 으로 들어갑니다.
   - Safari 공유 버튼 → **홈 화면에 추가**를 하면 앱처럼 쓸 수 있습니다.

## Gemini API 키
- https://aistudio.google.com/apikey 에서 무료로 발급합니다.
- Gemini Pro 구독에는 API 사용량이 포함되지 않습니다. 무료 한도를 넘으면 잠시 기다리거나 Flash 모델을 고르세요.
- 키는 이 기기의 브라우저(localStorage)에만 저장되고, Google 서버로만 전송됩니다.
