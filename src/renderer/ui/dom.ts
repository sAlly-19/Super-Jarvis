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

  // Settings Modal Shell & Dynamic Header Elements
  btnSettings: document.getElementById('btn-settings') as HTMLButtonElement,
  btnSettingsFullscreen: document.getElementById('btn-settings-fullscreen') as HTMLButtonElement | null,
  settingsModal: document.getElementById('settings-modal') as HTMLElement,
  btnCloseSettings: document.getElementById('btn-close-settings') as HTMLButtonElement,
  btnCancelSettings: document.getElementById('btn-cancel-settings') as HTMLButtonElement | null,
  btnSaveSettings: document.getElementById('btn-save-settings') as HTMLButtonElement,
  settingsStatus: document.getElementById('settings-status') as HTMLElement,
  settingsSectionTitle: document.getElementById('settings-section-title') as HTMLElement | null,
  settingsSectionDescription: document.getElementById('settings-section-description') as HTMLElement | null,
  settingsConnectionStatus: document.getElementById('settings-connection-status') as HTMLElement | null,
  settingsConnectionDetail: document.getElementById('settings-connection-detail') as HTMLElement | null,
  agentNamePreview: document.getElementById('agent-name-preview') as HTMLElement | null,

  // Settings Form Inputs & Provider Controls
  inputAgentName: document.getElementById('input-agent-name') as HTMLInputElement | null,
  selectAiProvider: document.getElementById('select-ai-provider') as HTMLSelectElement,
  inputGeminiKey: document.getElementById('input-gemini-key') as HTMLInputElement,
  btnToggleGeminiKey: document.getElementById('btn-toggle-gemini-key') as HTMLButtonElement | null,
  btnRemoveGeminiKey: document.getElementById('btn-remove-gemini-key') as HTMLButtonElement | null,
  geminiCredentialStatus: document.getElementById('gemini-credential-status') as HTMLElement | null,
  inputGroqKey: document.getElementById('input-groq-key') as HTMLInputElement,
  btnToggleGroqKey: document.getElementById('btn-toggle-groq-key') as HTMLButtonElement | null,
  btnRemoveGroqKey: document.getElementById('btn-remove-groq-key') as HTMLButtonElement | null,
  groqCredentialStatus: document.getElementById('groq-credential-status') as HTMLElement | null,
  ollamaProviderStatus: document.getElementById('ollama-provider-status') as HTMLElement | null,
  selectVoice: document.getElementById('select-voice') as HTMLSelectElement,
  selectModel: document.getElementById('select-model') as HTMLSelectElement,
  checkWakeWord: document.getElementById('check-wake-word') as HTMLInputElement | null,
  checkBloom: document.getElementById('check-bloom') as HTMLInputElement | null,
  checkNeuralBg: document.getElementById('check-neural-bg') as HTMLInputElement | null,
  checkEyeTracking: document.getElementById('check-eye-tracking') as HTMLInputElement | null,

  // System & Automation Controls
  checkScreenAwareness: document.getElementById('check-screen-awareness') as HTMLInputElement | null,
  operationalConsentStatus: document.getElementById('operational-consent-status') as HTMLElement | null,

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

  // License Tab Elements
  tabLicenseHwid: document.getElementById('tab-license-hwid') as HTMLElement | null,
  tabBtnCopyHwid: document.getElementById('tab-btn-copy-hwid') as HTMLButtonElement | null,
  tabLicenseKey: document.getElementById('tab-license-key') as HTMLInputElement | null,
  tabBtnActivateKey: document.getElementById('tab-btn-activate-key') as HTMLButtonElement | null,
  tabLicenseBadgeStatus: document.getElementById('tab-license-badge-status') as HTMLElement | null,
  tabLicenseClientName: document.getElementById('tab-license-client-name') as HTMLElement | null,
  tabLicenseActivatedAt: document.getElementById('tab-license-activated-at') as HTMLElement | null,
  tabLicenseLastChecked: document.getElementById('tab-license-last-checked') as HTMLElement | null,
  tabLicenseFeedback: document.getElementById('tab-license-feedback') as HTMLElement | null,

  // License Activation & Provider Onboarding Modal
  modalLicenseActivation: document.getElementById('modal-license-activation') as HTMLElement | null,
  licenseModalTitle: document.getElementById('license-modal-title') as HTMLElement | null,
  licenseModalSubtitle: document.getElementById('license-modal-subtitle') as HTMLElement | null,
  stepLicenseActivation: document.getElementById('step-license-activation') as HTMLElement | null,
  stepGeminiOnboarding: document.getElementById('step-gemini-onboarding') as HTMLElement | null,
  selectOnboardingProvider: document.getElementById('select-onboarding-provider') as HTMLSelectElement | null,
  onboardingProviderKeyGroup: document.getElementById('onboarding-provider-key-group') as HTMLElement | null,
  inputOnboardingProviderKey: document.getElementById('input-onboarding-provider-key') as HTMLInputElement | null,
  btnToggleOnboardingKey: document.getElementById('btn-toggle-onboarding-key') as HTMLButtonElement | null,
  btnOpenGoogleAiStudio: document.getElementById('btn-open-google-ai-studio') as HTMLButtonElement | null,
  btnSaveOnboardingGemini: document.getElementById('btn-save-onboarding-gemini') as HTMLButtonElement | null,
  onboardingProviderFeedback: document.getElementById('onboarding-provider-feedback') as HTMLElement | null
}
