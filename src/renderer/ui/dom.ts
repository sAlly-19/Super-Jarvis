/**
 * Centralized, typed DOM Element references for Jasper AI HUD
 */
export const DOM = {
  // Main Viewport & Layout
  app: document.getElementById('app') as HTMLElement | null,
  titlebar: document.getElementById('titlebar') as HTMLElement | null,
  canvasContainer: document.getElementById('canvas-container') as HTMLElement,

  // Status & Brand
  statusBadge: document.getElementById('status-badge') as HTMLElement | null,
  statusText: document.getElementById('status-text') as HTMLElement | null,
  brandName: document.querySelector('.brand-name') as HTMLElement | null,

  // Transcript Box
  transcriptBox: document.getElementById('transcript-box') as HTMLElement,
  transcriptText: document.getElementById('transcript-text') as HTMLElement,
  transcriptSpeaker: document.querySelector('.transcript-speaker') as HTMLElement | null,

  // Visualizer & Microphone
  visualizerCanvas: document.getElementById('visualizer-canvas') as HTMLCanvasElement,
  btnMic: document.getElementById('btn-mic') as HTMLButtonElement,
  micStatusLabel: document.getElementById('mic-status-label') as HTMLElement | null,

  // Chat Drawer
  btnToggleChat: document.getElementById('btn-toggle-chat') as HTMLButtonElement | null,
  chatInputDrawer: document.getElementById('chat-input-drawer') as HTMLElement | null,
  inputChatText: document.getElementById('input-chat-text') as HTMLInputElement | null,
  btnSendText: document.getElementById('btn-send-text') as HTMLButtonElement | null,

  // Window Controls & PIP
  btnFullscreen: document.getElementById('btn-fullscreen') as HTMLButtonElement | null,
  btnPip: document.getElementById('btn-pip') as HTMLButtonElement | null,
  btnMinimize: document.getElementById('btn-minimize') as HTMLButtonElement | null,
  btnMaximize: document.getElementById('btn-maximize') as HTMLButtonElement | null,
  btnClose: document.getElementById('btn-close') as HTMLButtonElement | null,

  // Settings Modal Elements
  btnSettings: document.getElementById('btn-settings') as HTMLButtonElement,
  btnSettingsFullscreen: document.getElementById('btn-settings-fullscreen') as HTMLButtonElement | null,
  settingsModal: document.getElementById('settings-modal') as HTMLElement,
  btnCloseSettings: document.getElementById('btn-close-settings') as HTMLButtonElement,
  btnCancelSettings: document.getElementById('btn-cancel-settings') as HTMLButtonElement | null,
  btnSaveSettings: document.getElementById('btn-save-settings') as HTMLButtonElement,
  settingsStatus: document.getElementById('settings-status') as HTMLElement,
  agentNamePreview: document.getElementById('agent-name-preview') as HTMLElement | null,

  // Settings Form Inputs
  inputAgentName: document.getElementById('input-agent-name') as HTMLInputElement | null,
  inputApiKey: document.getElementById('input-api-key') as HTMLInputElement,
  btnToggleKey: document.getElementById('btn-toggle-key') as HTMLButtonElement,
  btnRemoveKey: document.getElementById('btn-remove-key') as HTMLButtonElement | null,
  selectVoice: document.getElementById('select-voice') as HTMLSelectElement,
  selectModel: document.getElementById('select-model') as HTMLSelectElement,
  checkWakeWord: document.getElementById('check-wake-word') as HTMLInputElement | null,
  checkBloom: document.getElementById('check-bloom') as HTMLInputElement | null,
  checkNeuralBg: document.getElementById('check-neural-bg') as HTMLInputElement | null,
  checkEyeTracking: document.getElementById('check-eye-tracking') as HTMLInputElement | null,
  checkSystemTools: document.getElementById('check-system-tools') as HTMLInputElement | null,
  checkMediaTools: document.getElementById('check-media-tools') as HTMLInputElement | null,

  // Autonomy Checkbox Elements
  checkScreenAwareness: document.getElementById('check-screen-awareness') as HTMLInputElement | null,
  checkWindowTracker: document.getElementById('check-window-tracker') as HTMLInputElement | null,
  checkClipboardWatcher: document.getElementById('check-clipboard-watcher') as HTMLInputElement | null,
  checkCronEngine: document.getElementById('check-cron-engine') as HTMLInputElement | null,
  checkDailyBriefing: document.getElementById('check-daily-briefing') as HTMLInputElement | null,
  checkSystemHealth: document.getElementById('check-system-health') as HTMLInputElement | null,
  checkSemanticMemory: document.getElementById('check-semantic-memory') as HTMLInputElement | null,
  checkKnowledgeGraph: document.getElementById('check-knowledge-graph') as HTMLInputElement | null,
  checkHeadlessBrowser: document.getElementById('check-headless-browser') as HTMLInputElement | null,
  checkGitWatcher: document.getElementById('check-git-watcher') as HTMLInputElement | null,
  checkFolderOrganizer: document.getElementById('check-folder-organizer') as HTMLInputElement | null,
  checkSubagents: document.getElementById('check-subagents') as HTMLInputElement | null,
  checkReflexionLoop: document.getElementById('check-reflexion-loop') as HTMLInputElement | null,
  checkCalendarEmail: document.getElementById('check-calendar-email') as HTMLInputElement | null,
  checkWebhooks: document.getElementById('check-webhooks') as HTMLInputElement | null,
  checkSmartHome: document.getElementById('check-smart-home') as HTMLInputElement | null,
  checkProcessManager: document.getElementById('check-process-manager') as HTMLInputElement | null,
  checkUiAutomation: document.getElementById('check-ui-automation') as HTMLInputElement | null,
  checkMediaController: document.getElementById('check-media-controller') as HTMLInputElement | null,
  checkReportGenerator: document.getElementById('check-report-generator') as HTMLInputElement | null,
  checkFileSummarizer: document.getElementById('check-file-summarizer') as HTMLInputElement | null,
  checkQrService: document.getElementById('check-qr-service') as HTMLInputElement | null,
  checkOcrService: document.getElementById('check-ocr-service') as HTMLInputElement | null,
  checkPresentationMode: document.getElementById('check-presentation-mode') as HTMLInputElement | null,
  checkFocusMode: document.getElementById('check-focus-mode') as HTMLInputElement | null,

  // Toast Container
  hudToastContainer: document.getElementById('hud-toast-container') as HTMLElement | null,

  // Memory Elements
  memoryCountBadge: document.getElementById('memory-count-badge') as HTMLElement | null,
  memoryFactsList: document.getElementById('memory-facts-list') as HTMLElement | null,
  btnClearMemory: document.getElementById('btn-clear-memory') as HTMLButtonElement | null,

  // Voice Trainer Elements
  badgeModelState: document.getElementById('badge-model-state') as HTMLElement | null,
  wakeStatusTitle: document.getElementById('wake-status-title') as HTMLElement | null,
  wakeStatusDesc: document.getElementById('wake-status-desc') as HTMLElement | null,
  wakeStatusIcon: document.getElementById('wake-status-icon') as HTMLElement | null,
  countNameSamples: document.getElementById('count-name-samples') as HTMLElement | null,
  countNoiseSamples: document.getElementById('count-noise-samples') as HTMLElement | null,
  countOtherSamples: document.getElementById('count-other-samples') as HTMLElement | null,
  btnSampleName: document.getElementById('btn-sample-name') as HTMLButtonElement | null,
  btnSampleNoise: document.getElementById('btn-sample-noise') as HTMLButtonElement | null,
  btnSampleOther: document.getElementById('btn-sample-other') as HTMLButtonElement | null,
  btnTrainCustomModel: document.getElementById('btn-train-custom-model') as HTMLButtonElement | null,
  btnResetCustomModel: document.getElementById('btn-reset-custom-model') as HTMLButtonElement | null,
  trainerFeedback: document.getElementById('trainer-feedback-msg') as HTMLElement | null,

  // Module Specific Config Elements
  inputGitRepoPath: document.getElementById('input-git-repo-path') as HTMLInputElement | null,
  btnBrowseGitRepo: document.getElementById('btn-browse-git-repo') as HTMLButtonElement | null,
  selectFolderTarget: document.getElementById('select-folder-target') as HTMLSelectElement | null,
  inputEmailHost: document.getElementById('input-email-host') as HTMLInputElement | null,
  inputEmailPort: document.getElementById('input-email-port') as HTMLInputElement | null,
  inputEmailUser: document.getElementById('input-email-user') as HTMLInputElement | null,
  inputEmailPassword: document.getElementById('input-email-password') as HTMLInputElement | null,
  btnToggleEmailPw: document.getElementById('btn-toggle-email-pw') as HTMLButtonElement | null,
  inputWebhookUrl: document.getElementById('input-webhook-url') as HTMLInputElement | null,
  btnTestWebhook: document.getElementById('btn-test-webhook') as HTMLButtonElement | null,
  webhookTestFeedback: document.getElementById('webhook-test-feedback') as HTMLElement | null,
  inputHassUrl: document.getElementById('input-hass-url') as HTMLInputElement | null,
  inputHassToken: document.getElementById('input-hass-token') as HTMLInputElement | null,
  btnToggleHassToken: document.getElementById('btn-toggle-hass-token') as HTMLButtonElement | null,
  btnTestHass: document.getElementById('btn-test-hass') as HTMLButtonElement | null,
  hassTestFeedback: document.getElementById('hass-test-feedback') as HTMLElement | null,

  // License Tab Elements
  tabLicenseHwid: document.getElementById('tab-license-hwid') as HTMLElement | null,
  tabBtnCopyHwid: document.getElementById('tab-btn-copy-hwid') as HTMLButtonElement | null,
  tabLicenseKey: document.getElementById('tab-license-key') as HTMLInputElement | null,
  tabBtnActivateKey: document.getElementById('tab-btn-activate-key') as HTMLButtonElement | null,
  tabLicenseBadgeStatus: document.getElementById('tab-license-badge-status') as HTMLElement | null,
  tabLicenseClientName: document.getElementById('tab-license-client-name') as HTMLElement | null,
  tabLicenseActivatedAt: document.getElementById('tab-license-activated-at') as HTMLElement | null,
  tabLicenseFeedback: document.getElementById('tab-license-feedback') as HTMLElement | null,

  // Gemini Settings & Onboarding
  geminiKeyMaskedDisplay: document.getElementById('gemini-key-masked-display') as HTMLElement | null,
  modalLicenseActivation: document.getElementById('modal-license-activation') as HTMLElement | null,
  licenseModalTitle: document.getElementById('license-modal-title') as HTMLElement | null,
  licenseModalSubtitle: document.getElementById('license-modal-subtitle') as HTMLElement | null,
  stepLicenseActivation: document.getElementById('step-license-activation') as HTMLElement | null,
  stepGeminiOnboarding: document.getElementById('step-gemini-onboarding') as HTMLElement | null,
  inputOnboardingGeminiKey: document.getElementById('input-onboarding-gemini-key') as HTMLInputElement | null,
  btnToggleOnboardingKey: document.getElementById('btn-toggle-onboarding-key') as HTMLButtonElement | null,
  btnOpenGoogleAiStudio: document.getElementById('btn-open-google-ai-studio') as HTMLButtonElement | null,
  btnSaveOnboardingGemini: document.getElementById('btn-save-onboarding-gemini') as HTMLButtonElement | null,
  geminiOnboardingFeedback: document.getElementById('gemini-onboarding-feedback') as HTMLElement | null
}

