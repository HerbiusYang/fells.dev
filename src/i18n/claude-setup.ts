export interface ClaudeSetupWords {
  title: string;
  intro: string;
  platform: string;
  model: string;
  modelHint: string;
  saved: string;
  temporary: string;
  installTitle: string;
  installBody: string;
  installLink: string;
  keyTitle: string;
  keyBody: string;
  settingsTitle: string;
  settingsBody: string;
  mergeNote: string;
  replaceKey: string;
  secretNote: string;
  pathLabel: string;
  runTitle: string;
  runBody: string;
  verifyTitle: string;
  verifyBody: string;
  statusExpected: string;
  promptNote: string;
  temporaryTitle: string;
  temporaryBody: string;
  temporaryKeyPrompt: string;
  emptyKeyMessage: string;
  helpTitle: string;
  docs: string;
  permissionNote: string;
  noModelHint: string;
  copyConfig: string;
  copyCommand: string;
  help: Array<{ title: string; body: string }>;
}

const words: Record<string, ClaudeSetupWords> = {
  en: {
    title: "Claude Code CLI",
    intro: "Set up Fells once on your computer. After saving the settings, normally you only need to run claude to start.",
    platform: "Your operating system",
    model: "Model",
    modelHint: "Choose a Claude Code model available to the selected Fells key. The configuration below uses its exact model ID.",
    saved: "Set up once · Recommended",
    temporary: "Try this session",
    installTitle: "Install Claude Code",
    installBody: "Install the official Claude Code CLI for your operating system, then open a new system terminal.",
    installLink: "Official installation guide",
    keyTitle: "Prepare your full Fells API key",
    keyBody: "The complete key is shown only once when you create it. A prefix such as sk-ap-… or a masked value cannot be used. If you no longer have the full key, create a new one on this page.",
    settingsTitle: "Save your personal settings",
    settingsBody: "Create or edit the user settings.json file at the path below on your computer. If the file does not exist, create its folder first, then paste this configuration.",
    mergeNote: "If the file already exists, merge only model and the two Fells variables inside env into your existing JSON. Keep other settings and env variables. Do not add a second env object.",
    replaceKey: "Replace YOUR_FELLS_API_KEY with your complete key before saving.",
    secretNote: "Replace the placeholder only in your local user settings file. This file contains your key: do not store it in a project, share it, or paste it into a webpage or chat.",
    pathLabel: "User settings file",
    runTitle: "Start now and next time",
    runBody: "Save the file. Exit any running Claude Code session, then run the command below in your system terminal. Use the same command next time; you do not need to enter the key again.",
    verifyTitle: "Confirm the connection",
    verifyBody: "In Claude Code, run /status and check for api.fells.dev and ANTHROPIC_AUTH_TOKEN. Then send “Hello”. Receiving a model reply confirms the full connection; this request is billed normally.",
    statusExpected: "Expected: api.fells.dev · ANTHROPIC_AUTH_TOKEN",
    promptNote: "Paste shell commands into your computer’s system terminal, not the Claude Code chat box. Use /status inside Claude Code.",
    temporaryTitle: "Use Fells for this session",
    temporaryBody: "This command applies only to the Claude Code session it starts. A new terminal or running claude directly will not inherit it. Existing env values in settings.json take priority over these temporary shell values.",
    temporaryKeyPrompt: "Enter your full Fells API key: ",
    emptyKeyMessage: "No key entered. Run the command again.",
    helpTitle: "Having trouble?",
    docs: "Claude Code gateway documentation",
    permissionNote: "User settings apply to Claude Code CLI projects for your current computer user. Project or organization settings can override them; check /status if the expected configuration is missing.",
    noModelHint: "This key currently has no available Claude Code models. Refresh its model catalog or contact Fells support to check model access and routes. Do not guess a model ID.",
    copyConfig: "Copy configuration",
    copyCommand: "Copy command",
    help: [
      {
        title: "Not logged in · Please run /login",
        body: "If the login menu is open, press Esc to cancel and exit Claude Code. Check the complete key and the Fells URL in your settings, then restart. Fells does not require a Claude account login. The menu’s third option is for Bedrock, Vertex AI and similar platforms; it is not the Fells setup.",
      },
      {
        title: "command not found: claude",
        body: "Complete the official installation for your operating system, then open a new system terminal and run claude again.",
      },
      {
        title: "HTTP 401 or 403",
        body: "Check that the key is complete, has not been revoked, and has the required permissions and remaining allowance. Upstream authentication can also return 401 or 403. Keep the request ID and contact Fells support; repeatedly running /login will not resolve a gateway rejection.",
      },
      {
        title: "No route configured · No available model",
        body: "Refresh the model catalog for this key and select an available model. Fells support must check missing model permissions or routes; changing to a guessed model ID will not create a route.",
      },
      {
        title: "The settings did not take effect",
        body: "Check the correct user settings.json path, valid JSON, and both variables inside the existing env object. Exit and restart Claude Code. Check /status for project or organization settings that may take priority.",
      },
    ],
  },
  "zh-CN": {
    title: "Claude Code CLI",
    intro: "在电脑上配置一次，以后通常只需输入 claude 就能启动，无需反复输入地址和 Key。",
    platform: "电脑系统",
    model: "模型",
    modelHint: "选择当前 Fells Key 可用的 Claude Code 模型，下方配置会使用对应的准确模型 ID。",
    saved: "一次配置 · 推荐",
    temporary: "仅试用本次会话",
    installTitle: "安装 Claude Code",
    installBody: "按电脑系统安装官方 Claude Code CLI，完成后新开一个系统终端。",
    installLink: "官方安装指南",
    keyTitle: "准备完整的 Fells API Key",
    keyBody: "完整 Key 仅在创建时显示一次。sk-ap-… 等前缀或掩码不能用于连接；如果已找不到完整 Key，请在本页重新创建。",
    settingsTitle: "保存到个人配置文件",
    settingsBody: "在本机下方路径新建或编辑用户 settings.json。若文件不存在，先创建对应文件夹，再粘贴这份配置。",
    mergeNote: "已有文件时，仅将 model 和 env 内的两个 Fells 变量合并到原 JSON，保留其他设置和环境变量。已有 env 时请在其中添加，不要重复创建第二个 env。",
    replaceKey: "将 YOUR_FELLS_API_KEY 替换为你的完整 Key，再保存文件。",
    secretNote: "仅在本机用户配置文件中替换占位符。文件包含 Key，请勿存入项目、分享，或粘贴到网页及聊天中。",
    pathLabel: "用户配置文件",
    runTitle: "现在和以后都这样启动",
    runBody: "保存文件，退出正在运行的 Claude Code，再在系统终端输入下方命令。以后启动仍用这一条，无需重复输入 Key。",
    verifyTitle: "确认真正接通",
    verifyBody: "在 Claude Code 内输入 /status，确认显示 api.fells.dev 和 ANTHROPIC_AUTH_TOKEN。再发送“你好”，收到模型回复才代表完整接通；这次请求按正常规则计费。",
    statusExpected: "应显示：api.fells.dev · ANTHROPIC_AUTH_TOKEN",
    promptNote: "命令请粘贴到电脑的系统终端，不要粘贴到 Claude Code 聊天输入框；/status 在 Claude Code 内使用。",
    temporaryTitle: "本次会话临时连接 Fells",
    temporaryBody: "该命令仅对它启动的这次 Claude Code 会话生效。新开终端或直接运行 claude 不会继承；若 settings.json 已有 env 值，它们优先于这里的临时终端变量。",
    temporaryKeyPrompt: "请输入完整 Fells API Key：",
    emptyKeyMessage: "未输入 Key，请重新执行命令。",
    helpTitle: "遇到问题？",
    docs: "Claude Code 网关接入文档",
    permissionNote: "用户配置会影响这台电脑当前用户的 Claude Code CLI 项目。项目或组织配置可能覆盖它；未按预期生效时请查看 /status。",
    noModelHint: "当前 Key 暂无可用的 Claude Code 模型。请刷新此 Key 的模型目录，或联系 Fells 支持核对模型权限和路由，不要自行猜测模型 ID。",
    copyConfig: "复制配置",
    copyCommand: "复制命令",
    help: [
      {
        title: "Not logged in · Please run /login",
        body: "若已进入登录菜单，按 Esc 取消并退出 Claude Code。检查配置中的完整 Key 和 Fells 地址后重新启动。Fells 无需登录 Claude 账号；菜单第 3 项是 Bedrock、Vertex AI 等平台，并非 Fells 的配置入口。",
      },
      {
        title: "command not found: claude",
        body: "先按系统完成官方安装，再新开一个系统终端，重新运行 claude。",
      },
      {
        title: "HTTP 401 或 403",
        body: "检查 Key 是否完整、是否已撤销、权限及剩余额度是否足够。上游鉴权也可能返回 401 或 403。请记录请求 ID 联系 Fells 支持，不要反复执行 /login。",
      },
      {
        title: "no route configured · 无可用模型",
        body: "刷新此 Key 的模型目录，选择可用模型。缺少模型权限或路由时需由 Fells 支持核对配置，改成猜测的模型 ID 不会自动创建路由。",
      },
      {
        title: "保存后仍未生效",
        body: "确认使用正确的用户 settings.json 路径，JSON 格式有效，两个变量均在已有 env 内；退出并重启 Claude Code。通过 /status 检查是否被优先级更高的项目或组织配置覆盖。",
      },
    ],
  },
  "zh-TW": {
    title: "Claude Code CLI",
    intro: "在電腦上設定一次，以後通常只需輸入 claude 即可啟動，不必反覆輸入網址與 Key。",
    platform: "電腦系統",
    model: "模型",
    modelHint: "選擇目前 Fells Key 可用的 Claude Code 模型，下方設定會使用對應的正確模型 ID。",
    saved: "一次設定 · 建議",
    temporary: "僅試用本次工作階段",
    installTitle: "安裝 Claude Code",
    installBody: "依電腦系統安裝官方 Claude Code CLI，完成後開啟新的系統終端機。",
    installLink: "官方安裝指南",
    keyTitle: "準備完整的 Fells API Key",
    keyBody: "完整 Key 僅在建立時顯示一次。sk-ap-… 等前綴或遮罩無法用於連線；若已找不到完整 Key，請在本頁重新建立。",
    settingsTitle: "儲存至個人設定檔",
    settingsBody: "在本機下方路徑建立或編輯使用者 settings.json。若檔案不存在，請先建立對應資料夾，再貼上這份設定。",
    mergeNote: "已有檔案時，僅將 model 和 env 內的兩個 Fells 變數合併到原 JSON，保留其他設定與環境變數。已有 env 時請在其中新增，不要重複建立第二個 env。",
    replaceKey: "將 YOUR_FELLS_API_KEY 換成你的完整 Key，再儲存檔案。",
    secretNote: "僅在本機使用者設定檔中替換預留文字。檔案含有 Key，請勿存入專案、分享，或貼到網頁及聊天中。",
    pathLabel: "使用者設定檔",
    runTitle: "現在與以後都這樣啟動",
    runBody: "儲存檔案，結束正在執行的 Claude Code，再於系統終端機輸入下方指令。以後啟動仍使用這一條，不必再次輸入 Key。",
    verifyTitle: "確認完整連線",
    verifyBody: "在 Claude Code 內輸入 /status，確認顯示 api.fells.dev 和 ANTHROPIC_AUTH_TOKEN。再傳送「你好」，收到模型回覆才代表完整接通；這次請求依正常規則計費。",
    statusExpected: "應顯示：api.fells.dev · ANTHROPIC_AUTH_TOKEN",
    promptNote: "指令請貼到電腦的系統終端機，不要貼到 Claude Code 聊天輸入框；/status 在 Claude Code 內使用。",
    temporaryTitle: "本次工作階段暫時連線至 Fells",
    temporaryBody: "此指令僅適用於它啟動的這次 Claude Code 工作階段。開啟新終端機或直接執行 claude 不會繼承；若 settings.json 已有 env 值，其優先順序高於這裡的暫時終端機變數。",
    temporaryKeyPrompt: "請輸入完整 Fells API Key：",
    emptyKeyMessage: "未輸入 Key，請重新執行指令。",
    helpTitle: "遇到問題？",
    docs: "Claude Code 閘道連線文件",
    permissionNote: "使用者設定會影響這台電腦目前使用者的 Claude Code CLI 專案。專案或組織設定可能覆寫它；未如預期生效時請查看 /status。",
    noModelHint: "目前 Key 沒有可用的 Claude Code 模型。請重新整理此 Key 的模型目錄，或聯絡 Fells 支援核對模型權限與路由，不要自行猜測模型 ID。",
    copyConfig: "複製設定",
    copyCommand: "複製指令",
    help: [
      {
        title: "Not logged in · Please run /login",
        body: "若已進入登入選單，按 Esc 取消並結束 Claude Code。檢查設定中的完整 Key 與 Fells 網址後重新啟動。Fells 不必登入 Claude 帳號；選單第 3 項是 Bedrock、Vertex AI 等平台，並非 Fells 的設定入口。",
      },
      {
        title: "command not found: claude",
        body: "先依系統完成官方安裝，再開啟新的系統終端機，重新執行 claude。",
      },
      {
        title: "HTTP 401 或 403",
        body: "檢查 Key 是否完整、是否已撤銷，以及權限和剩餘額度是否足夠。上游驗證也可能回傳 401 或 403。請記下請求 ID 聯絡 Fells 支援，不要反覆執行 /login。",
      },
      {
        title: "no route configured · 無可用模型",
        body: "重新整理此 Key 的模型目錄，選擇可用模型。缺少模型權限或路由時，需由 Fells 支援核對設定；改成猜測的模型 ID 不會自動建立路由。",
      },
      {
        title: "儲存後仍未生效",
        body: "確認使用正確的使用者 settings.json 路徑、JSON 格式有效，且兩個變數都在已有的 env 內；結束並重新啟動 Claude Code。透過 /status 檢查是否被優先順序更高的專案或組織設定覆寫。",
      },
    ],
  },
  ja: {
    title: "Claude Code CLI",
    intro: "パソコンで一度設定すれば、通常は claude と入力するだけで起動できます。URL や Key の再入力は不要です。",
    platform: "パソコンの OS",
    model: "モデル",
    modelHint: "選択した Fells Key で利用できる Claude Code モデルを選んでください。下の設定には正確なモデル ID が入ります。",
    saved: "一度設定する · 推奨",
    temporary: "今回だけ試す",
    installTitle: "Claude Code をインストール",
    installBody: "OS に合う公式 Claude Code CLI をインストールし、新しいシステムターミナルを開いてください。",
    installLink: "公式インストールガイド",
    keyTitle: "完全な Fells API Key を用意",
    keyBody: "完全な Key が表示されるのは作成時の一度だけです。sk-ap-… などの先頭部分や伏せ字では接続できません。完全な Key が見つからない場合は、このページで新しく作成してください。",
    settingsTitle: "ユーザー設定ファイルに保存",
    settingsBody: "パソコン上の次の場所で、ユーザー用 settings.json を新規作成または編集してください。ファイルがない場合は先にフォルダーを作り、この設定を貼り付けます。",
    mergeNote: "既存のファイルがある場合は、model と env 内の Fells 変数 2 つだけを既存の JSON に統合します。他の設定と環境変数は残してください。env がある場合はその中に追加し、2 つ目の env を作らないでください。",
    replaceKey: "YOUR_FELLS_API_KEY を完全な Key に置き換えて保存してください。",
    secretNote: "置き換えるのはローカルのユーザー設定ファイル内だけにしてください。Key を含むファイルをプロジェクトに保存したり、共有したり、ウェブページやチャットに貼り付けたりしないでください。",
    pathLabel: "ユーザー設定ファイル",
    runTitle: "今回も次回も同じコマンドで起動",
    runBody: "ファイルを保存し、実行中の Claude Code を終了してから、システムターミナルで次のコマンドを実行します。次回もこのコマンドだけで起動でき、Key の再入力は不要です。",
    verifyTitle: "接続を確認",
    verifyBody: "Claude Code 内で /status を実行し、api.fells.dev と ANTHROPIC_AUTH_TOKEN を確認します。次に「こんにちは」と送信してください。モデルからの返答で初めて接続全体を確認できます。このリクエストは通常どおり課金されます。",
    statusExpected: "確認する表示：api.fells.dev · ANTHROPIC_AUTH_TOKEN",
    promptNote: "シェルコマンドは Claude Code のチャット欄ではなく、パソコンのシステムターミナルに貼り付けてください。/status は Claude Code 内で使います。",
    temporaryTitle: "今回のセッションだけ Fells を利用",
    temporaryBody: "このコマンドで起動する Claude Code セッションだけに適用されます。新しいターミナルや claude の直接起動には引き継がれません。settings.json に既存の env 値がある場合、そちらが一時的なシェル変数より優先されます。",
    temporaryKeyPrompt: "完全な Fells API Key を入力してください：",
    emptyKeyMessage: "Key が入力されていません。コマンドを再実行してください。",
    helpTitle: "うまく動かないとき",
    docs: "Claude Code ゲートウェイ接続ドキュメント",
    permissionNote: "ユーザー設定は、このパソコンの現在のユーザーが使う Claude Code CLI プロジェクトに適用されます。プロジェクトや組織の設定で上書きされる場合があります。反映されない場合は /status を確認してください。",
    noModelHint: "この Key では現在利用できる Claude Code モデルがありません。Key のモデル一覧を更新するか、Fells サポートにモデル権限とルートの確認を依頼してください。モデル ID を推測しないでください。",
    copyConfig: "設定をコピー",
    copyCommand: "コマンドをコピー",
    help: [
      {
        title: "Not logged in · Please run /login",
        body: "ログインメニューが開いている場合は Esc でキャンセルし、Claude Code を終了します。設定の完全な Key と Fells URL を確認して再起動してください。Fells では Claude アカウントへのログインは不要です。メニューの 3 番は Bedrock、Vertex AI などのプラットフォーム用で、Fells 用ではありません。",
      },
      {
        title: "command not found: claude",
        body: "OS に合う公式インストールを完了し、新しいシステムターミナルを開いて claude を再実行してください。",
      },
      {
        title: "HTTP 401 または 403",
        body: "Key が完全で、失効しておらず、必要な権限と残り利用枠があるか確認してください。上流の認証でも 401 や 403 が返る場合があります。リクエスト ID を控えて Fells サポートに連絡してください。/login を繰り返してもゲートウェイの拒否は解消しません。",
      },
      {
        title: "no route configured · 利用できるモデルがない",
        body: "この Key のモデル一覧を更新し、利用可能なモデルを選んでください。権限やルートがない場合は Fells サポートの確認が必要です。推測したモデル ID に変えてもルートは作成されません。",
      },
      {
        title: "設定が反映されない",
        body: "ユーザー用 settings.json の場所、JSON の形式、既存の env 内にある 2 つの変数を確認し、Claude Code を終了して再起動してください。/status で、より優先されるプロジェクトや組織の設定も確認します。",
      },
    ],
  },
  ko: {
    title: "Claude Code CLI",
    intro: "컴퓨터에서 한 번 설정하면 보통 claude만 입력해 시작할 수 있습니다. 주소와 Key를 매번 입력할 필요가 없습니다.",
    platform: "컴퓨터 운영체제",
    model: "모델",
    modelHint: "선택한 Fells Key로 이용할 수 있는 Claude Code 모델을 선택하세요. 아래 설정에 정확한 모델 ID가 들어갑니다.",
    saved: "한 번 설정하기 · 권장",
    temporary: "이번 세션만 사용",
    installTitle: "Claude Code 설치",
    installBody: "운영체제에 맞는 공식 Claude Code CLI를 설치한 뒤 새 시스템 터미널을 여세요.",
    installLink: "공식 설치 안내",
    keyTitle: "전체 Fells API Key 준비",
    keyBody: "전체 Key는 생성할 때 한 번만 표시됩니다. sk-ap-… 같은 접두사나 가려진 값으로는 연결할 수 없습니다. 전체 Key를 찾을 수 없다면 이 페이지에서 새로 만드세요.",
    settingsTitle: "개인 설정 파일에 저장",
    settingsBody: "컴퓨터의 아래 경로에서 사용자 settings.json 파일을 만들거나 수정하세요. 파일이 없다면 먼저 해당 폴더를 만든 뒤 이 설정을 붙여 넣으세요.",
    mergeNote: "파일이 있다면 model과 env 안의 Fells 변수 2개만 기존 JSON에 합치세요. 다른 설정과 환경 변수는 유지하세요. env가 있다면 그 안에 추가하고 두 번째 env 객체를 만들지 마세요.",
    replaceKey: "YOUR_FELLS_API_KEY를 전체 Key로 바꾼 뒤 저장하세요.",
    secretNote: "자리표시자는 로컬 사용자 설정 파일에서만 바꾸세요. Key가 들어 있는 파일을 프로젝트에 저장하거나 공유하거나 웹페이지 및 채팅에 붙여 넣지 마세요.",
    pathLabel: "사용자 설정 파일",
    runTitle: "지금도 다음에도 같은 명령으로 시작",
    runBody: "파일을 저장하고 실행 중인 Claude Code를 종료한 뒤 시스템 터미널에서 아래 명령을 실행하세요. 다음에도 이 명령만 쓰면 되며 Key를 다시 입력할 필요가 없습니다.",
    verifyTitle: "실제 연결 확인",
    verifyBody: "Claude Code 안에서 /status를 실행해 api.fells.dev와 ANTHROPIC_AUTH_TOKEN을 확인하세요. 그런 다음 “안녕하세요”를 보내세요. 모델 답변을 받아야 전체 연결이 확인되며, 이 요청에는 정상 과금이 적용됩니다.",
    statusExpected: "확인할 표시: api.fells.dev · ANTHROPIC_AUTH_TOKEN",
    promptNote: "셸 명령은 Claude Code 채팅 입력창이 아닌 컴퓨터의 시스템 터미널에 붙여 넣으세요. /status는 Claude Code 안에서 사용하세요.",
    temporaryTitle: "이번 세션에서만 Fells 연결",
    temporaryBody: "이 명령으로 시작한 Claude Code 세션에만 적용됩니다. 새 터미널이나 claude 직접 실행에는 이어지지 않습니다. settings.json에 기존 env 값이 있다면 해당 값이 임시 셸 변수보다 우선합니다.",
    temporaryKeyPrompt: "전체 Fells API Key를 입력하세요: ",
    emptyKeyMessage: "Key를 입력하지 않았습니다. 명령을 다시 실행하세요.",
    helpTitle: "문제가 있나요?",
    docs: "Claude Code 게이트웨이 연결 문서",
    permissionNote: "사용자 설정은 이 컴퓨터의 현재 사용자가 사용하는 Claude Code CLI 프로젝트에 적용됩니다. 프로젝트나 조직 설정이 이를 덮어쓸 수 있습니다. 예상대로 적용되지 않으면 /status를 확인하세요.",
    noModelHint: "이 Key로 이용할 수 있는 Claude Code 모델이 없습니다. Key의 모델 목록을 새로 고치거나 Fells 지원팀에 모델 권한과 경로를 확인해 달라고 요청하세요. 모델 ID를 추측하지 마세요.",
    copyConfig: "설정 복사",
    copyCommand: "명령 복사",
    help: [
      {
        title: "Not logged in · Please run /login",
        body: "로그인 메뉴가 열려 있다면 Esc로 취소하고 Claude Code를 종료하세요. 설정의 전체 Key와 Fells 주소를 확인한 뒤 다시 시작하세요. Fells는 Claude 계정 로그인이 필요하지 않습니다. 메뉴의 3번은 Bedrock, Vertex AI 같은 플랫폼용이며 Fells 설정 항목이 아닙니다.",
      },
      {
        title: "command not found: claude",
        body: "운영체제에 맞는 공식 설치를 완료한 뒤 새 시스템 터미널을 열고 claude를 다시 실행하세요.",
      },
      {
        title: "HTTP 401 또는 403",
        body: "Key가 완전하고 취소되지 않았는지, 필요한 권한과 남은 사용 한도가 있는지 확인하세요. 상위 서비스 인증에서도 401 또는 403이 반환될 수 있습니다. 요청 ID를 기록해 Fells 지원팀에 문의하세요. /login을 반복해도 게이트웨이 거부는 해결되지 않습니다.",
      },
      {
        title: "no route configured · 이용 가능한 모델 없음",
        body: "이 Key의 모델 목록을 새로 고친 뒤 이용 가능한 모델을 선택하세요. 모델 권한이나 경로가 없다면 Fells 지원팀이 설정을 확인해야 합니다. 추측한 모델 ID로 바꿔도 경로가 만들어지지 않습니다.",
      },
      {
        title: "설정이 적용되지 않음",
        body: "올바른 사용자 settings.json 경로, 유효한 JSON 형식, 기존 env 안의 변수 2개를 확인한 뒤 Claude Code를 종료하고 다시 시작하세요. /status에서 우선순위가 높은 프로젝트나 조직 설정도 확인하세요.",
      },
    ],
  },
  es: {
    title: "Claude Code CLI",
    intro: "Configura Fells una vez en tu ordenador. Tras guardar los ajustes, normalmente basta con ejecutar claude para empezar.",
    platform: "Tu sistema operativo",
    model: "Modelo",
    modelHint: "Elige un modelo de Claude Code disponible para la Key de Fells seleccionada. La configuración de abajo usa su ID exacto.",
    saved: "Configurar una vez · Recomendado",
    temporary: "Probar en esta sesión",
    installTitle: "Instala Claude Code",
    installBody: "Instala la CLI oficial de Claude Code para tu sistema operativo y abre una nueva terminal del sistema.",
    installLink: "Guía oficial de instalación",
    keyTitle: "Prepara tu API Key completa de Fells",
    keyBody: "La Key completa solo se muestra una vez al crearla. Un prefijo como sk-ap-… o un valor oculto no sirve para conectarse. Si ya no tienes la Key completa, crea otra en esta página.",
    settingsTitle: "Guarda tus ajustes personales",
    settingsBody: "Crea o edita el archivo de usuario settings.json en la ruta de abajo, en tu ordenador. Si no existe, crea primero su carpeta y pega esta configuración.",
    mergeNote: "Si el archivo ya existe, incorpora solo model y las dos variables de Fells dentro de env al JSON actual. Conserva los demás ajustes y variables. Si ya existe env, añade las variables dentro; no crees un segundo objeto env.",
    replaceKey: "Sustituye YOUR_FELLS_API_KEY por tu Key completa antes de guardar.",
    secretNote: "Sustituye el marcador solo en el archivo de usuario de tu ordenador. El archivo contiene tu Key: no lo guardes en un proyecto, no lo compartas ni lo pegues en una web o un chat.",
    pathLabel: "Archivo de ajustes del usuario",
    runTitle: "Inicia ahora y las próximas veces",
    runBody: "Guarda el archivo, cierra cualquier sesión de Claude Code abierta y ejecuta el siguiente comando en la terminal del sistema. Usa el mismo comando la próxima vez; no tendrás que volver a introducir la Key.",
    verifyTitle: "Confirma la conexión",
    verifyBody: "Dentro de Claude Code, ejecuta /status y comprueba api.fells.dev y ANTHROPIC_AUTH_TOKEN. Después envía «Hola». Recibir una respuesta del modelo confirma la conexión completa; esta petición se factura con normalidad.",
    statusExpected: "Debe aparecer: api.fells.dev · ANTHROPIC_AUTH_TOKEN",
    promptNote: "Pega los comandos de shell en la terminal de tu ordenador, no en el chat de Claude Code. Usa /status dentro de Claude Code.",
    temporaryTitle: "Usa Fells solo en esta sesión",
    temporaryBody: "Este comando solo se aplica a la sesión de Claude Code que inicia. Una nueva terminal o ejecutar claude directamente no lo heredará. Los valores env existentes en settings.json tienen prioridad sobre estas variables temporales de shell.",
    temporaryKeyPrompt: "Introduce tu API Key completa de Fells: ",
    emptyKeyMessage: "No se ha introducido ninguna Key. Ejecuta el comando de nuevo.",
    helpTitle: "¿Tienes problemas?",
    docs: "Documentación de conexión al gateway de Claude Code",
    permissionNote: "Los ajustes de usuario se aplican a los proyectos de Claude Code CLI del usuario actual de este ordenador. Los ajustes del proyecto o de la organización pueden reemplazarlos; comprueba /status si no se aplica lo esperado.",
    noModelHint: "Esta Key no tiene modelos de Claude Code disponibles. Actualiza su catálogo o contacta con soporte de Fells para revisar el acceso a modelos y las rutas. No adivines un ID de modelo.",
    copyConfig: "Copiar configuración",
    copyCommand: "Copiar comando",
    help: [
      {
        title: "Not logged in · Please run /login",
        body: "Si el menú de inicio de sesión está abierto, pulsa Esc para cancelarlo y cierra Claude Code. Comprueba la Key completa y la URL de Fells en los ajustes y vuelve a iniciar. Fells no requiere iniciar sesión en una cuenta de Claude. La tercera opción del menú es para Bedrock, Vertex AI y plataformas similares; no es la configuración de Fells.",
      },
      {
        title: "command not found: claude",
        body: "Completa la instalación oficial para tu sistema operativo, abre una nueva terminal del sistema y ejecuta claude de nuevo.",
      },
      {
        title: "HTTP 401 o 403",
        body: "Comprueba que la Key esté completa, no se haya revocado y tenga los permisos y el saldo de uso necesarios. La autenticación del proveedor también puede devolver 401 o 403. Guarda el ID de petición y contacta con soporte de Fells; repetir /login no resuelve un rechazo del gateway.",
      },
      {
        title: "no route configured · Sin modelos disponibles",
        body: "Actualiza el catálogo de esta Key y elige un modelo disponible. Soporte de Fells debe revisar los permisos o las rutas que falten; cambiar a un ID de modelo adivinado no crea una ruta.",
      },
      {
        title: "Los ajustes no se aplican",
        body: "Comprueba la ruta correcta de settings.json del usuario, que el JSON sea válido y que ambas variables estén dentro del objeto env existente. Cierra y reinicia Claude Code. Revisa /status por si los ajustes del proyecto o de la organización tienen prioridad.",
      },
    ],
  },
};

export function claudeSetupWordsOf(lang: string): ClaudeSetupWords {
  const locale = lang === "zh" ? "zh-CN" : lang === "zh-hant" ? "zh-TW" : lang;
  return Object.hasOwn(words, locale) ? words[locale] : words.en;
}
