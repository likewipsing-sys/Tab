# 베이스 연습 노트

iPad Safari에서 쓰는 베이스 연습 웹앱입니다. 메트로놈, 주법별 연습 악보, Gemini가 만드는 연습 악보, PDF 악보 자동 스크롤, 연습 기록, 영상·음원 채보를 한곳에 모았습니다.

## 기능
- **메트로놈**
  - 박자, 박 나누기(8분·3연음·16분), 첫 박 강조, 탭 템포
  - 점점 빠르게(스피드 트레이너), 소리 끊기(박자감 훈련)
- **주법 연습**
  - 스케일, 핑거링, 워킹, 슬랩, 하모닉스, 그루브·고스트노트, 해머링·풀링
  - 연습 악보를 규칙으로 바로 만듭니다 (AI 없이 동작)
  - 베이스 소리 + 클릭으로 재생, 예비박, 구간 반복, 반복할 때마다 BPM 올리기
- **AI 악보**: 장르·주법·난이도·조성·마디 수를 고르면 Gemini가 연습 악보를 씁니다. 치기 어려운 부분은 자동으로 정리합니다.
- **라이브러리**
  - 저장한 악보, 가져온 PDF 악보
  - PDF는 자동 스크롤 속도 조절, 곡 길이에 맞추기, 시작 전 대기, 블루투스 페이지 넘김 페달(스페이스·화살표 키) 지원
- **기록**: 오늘·연속 연습일·이번 주 연습 시간, 주법별 시간, 악보별 최고 BPM
- **채보**: 영상·음원에서 베이스 타브를 뽑는 기존 기능. 결과를 "연습 라이브러리에 저장"할 수 있습니다.
- **로그인**: Google 계정 (Firebase). 로그인하지 않아도 이 기기에 저장됩니다.

## 1. GitHub Pages에 올리기 (iPad)
1. zip 파일을 **파일** 앱에서 탭해 압축을 풉니다.
2. Safari에서 github.com → **+** → **New repository** → 이름 `bass-practice` → **Public** → **Create repository**
   - 이미 만든 `bass-tab` 저장소를 써도 됩니다. 그때는 같은 이름의 파일을 덮어씁니다.
3. **uploading an existing file** → 압축 푼 폴더의 파일 **전부(17개)** 를 고릅니다 → **Commit changes**
4. **Settings → Pages** → Branch **main** / **(root)** → **Save**
5. 1~2분 뒤 `https://<내 아이디>.github.io/bass-practice/` 로 들어갑니다. 공유 → **홈 화면에 추가**하면 앱처럼 쓸 수 있습니다.

여기까지만 해도 로그인 없이 모든 기능을 쓸 수 있습니다 (기록은 이 iPad에만 저장).

## 2. Google 로그인 켜기 (Firebase, 무료)
1. https://console.firebase.google.com → **프로젝트 추가**
   - 이름 예: `bass-practice`
   - Google 애널리틱스는 꺼도 됩니다
2. 왼쪽 **빌드 → Authentication** → **시작하기**
   - **로그인 방법** 탭에서 **Google**을 고릅니다
   - **사용 설정** → 지원 이메일 고르기 → **저장**
3. **Authentication → 설정 → 승인된 도메인** → **도메인 추가** → `<내 아이디>.github.io`
4. 왼쪽 **빌드 → Firestore Database** → **데이터베이스 만들기**
   - 위치: `asia-northeast3 (서울)`
   - **프로덕션 모드**로 만듭니다
   - **규칙** 탭에서 아래 내용으로 바꾸고 **게시**:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{uid}/{document=**} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }
     }
   }
   ```
5. 톱니바퀴 **프로젝트 설정 → 일반 → 내 앱 → 웹(</>)**
   - 앱 닉네임을 넣고 **앱 등록**
   - 화면에 나오는 `const firebaseConfig = { … };` 부분을 복사합니다
6. 앱의 **설정** 탭 → **Firebase 설정** → 붙여넣기 → **저장하고 다시 불러오기** → **Google로 로그인**

무료 요금제(Spark)로 충분합니다. 악보·기록·PDF는 모두 Firestore에 저장되고, PDF는 900KB 조각으로 나눠 저장합니다(파일당 최대 20MB).
로그인하면 그동안 이 기기에 저장한 악보·기록도 계정으로 옮겨집니다.

## 3. Gemini 연결
**설정** 탭에 Google AI Studio API 키(https://aistudio.google.com/apikey)를 넣고 **연결 확인**을 누르세요. Gemini Pro 구독에는 API 사용량이 포함되지 않습니다. 무료 한도를 넘으면 모델을 Flash로 바꾸세요.

## 파일
| 파일 | 내용 |
|---|---|
| index.html | 화면 |
| main.js | 연습 앱 동작 |
| audio.js | 메트로놈·베이스 소리·재생 |
| theory.js | 스케일·코드·연습 악보 생성 |
| ai.js | Gemini 악보 생성·검사 |
| tabview.js | 손글씨 타브 그리기 |
| store.js | 저장·로그인·동기화 |
| pdfview.js, pdf.min.js, pdf.worker.min.js | PDF 보기 (Mozilla pdf.js, Apache 2.0 — LICENSE-pdfjs.txt) |
| firebase-config.js | Firebase 설정(비워 두고 앱 설정 탭에 붙여넣어도 됨) |
| app.js, core.js, track.js, engines.js | 채보 기능 |
