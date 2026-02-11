import Foundation
import Speech
import AVFoundation

/// On-device speech-to-text using Apple Speech framework.
/// Uses SFSpeechRecognizer with on-device recognition for privacy.
final class SpeechRecognizer: ObservableObject {
    // MARK: - Published State

    @Published var transcription: String = ""
    @Published var isRecording: Bool = false
    @Published var isAuthorized: Bool = false
    @Published var errorMessage: String? = nil

    // MARK: - Properties

    private let speechRecognizer: SFSpeechRecognizer?
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private let audioEngine = AVAudioEngine()
    private let logger = AlfredLogger.voice

    // MARK: - Init

    init(locale: Locale = .current) {
        self.speechRecognizer = SFSpeechRecognizer(locale: locale)
        checkAuthorization()
    }

    // MARK: - Authorization

    func checkAuthorization() {
        SFSpeechRecognizer.requestAuthorization { [weak self] status in
            DispatchQueue.main.async {
                switch status {
                case .authorized:
                    self?.isAuthorized = true
                    self?.logger.info("Speech recognition authorized")
                case .denied:
                    self?.isAuthorized = false
                    self?.errorMessage = "Speech recognition permission denied"
                    self?.logger.warning("Speech recognition denied")
                case .restricted:
                    self?.isAuthorized = false
                    self?.errorMessage = "Speech recognition restricted on this device"
                case .notDetermined:
                    self?.isAuthorized = false
                @unknown default:
                    self?.isAuthorized = false
                }
            }
        }
    }

    // MARK: - Start Recognition

    /// Start real-time speech recognition with on-device processing
    func startRecording() throws {
        guard let speechRecognizer = speechRecognizer, speechRecognizer.isAvailable else {
            throw SpeechError.recognizerNotAvailable
        }

        guard isAuthorized else {
            throw SpeechError.notAuthorized
        }

        // Cancel any existing task
        stopRecording()

        // Configure audio session
        let audioSession = AVAudioSession.sharedInstance()
        try audioSession.setCategory(.record, mode: .measurement, options: .duckOthers)
        try audioSession.setActive(true, options: .notifyOthersOnDeactivation)

        // Create recognition request with on-device processing
        recognitionRequest = SFSpeechAudioBufferRecognitionRequest()

        guard let recognitionRequest = recognitionRequest else {
            throw SpeechError.requestCreationFailed
        }

        // Force on-device recognition for privacy
        recognitionRequest.requiresOnDeviceRecognition = true
        recognitionRequest.shouldReportPartialResults = true

        // Create recognition task
        recognitionTask = speechRecognizer.recognitionTask(with: recognitionRequest) { [weak self] result, error in
            guard let self = self else { return }

            if let result = result {
                DispatchQueue.main.async {
                    self.transcription = result.bestTranscription.formattedString
                }

                if result.isFinal {
                    self.logger.info("Final transcription received")
                    self.stopRecording()
                }
            }

            if let error = error {
                self.logger.error("Recognition error: \(error.localizedDescription)")
                DispatchQueue.main.async {
                    self.errorMessage = error.localizedDescription
                }
                self.stopRecording()
            }
        }

        // Configure audio input
        let inputNode = audioEngine.inputNode
        let recordingFormat = inputNode.outputFormat(forBus: 0)

        inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { [weak self] buffer, _ in
            self?.recognitionRequest?.append(buffer)
        }

        // Start audio engine
        audioEngine.prepare()
        try audioEngine.start()

        DispatchQueue.main.async {
            self.isRecording = true
            self.transcription = ""
            self.errorMessage = nil
        }

        logger.info("Speech recognition started (on-device)")
    }

    // MARK: - Stop Recognition

    /// Stop the current recording and recognition
    func stopRecording() {
        audioEngine.stop()
        audioEngine.inputNode.removeTap(onBus: 0)
        recognitionRequest?.endAudio()
        recognitionRequest = nil
        recognitionTask?.cancel()
        recognitionTask = nil

        DispatchQueue.main.async {
            self.isRecording = false
        }

        logger.info("Speech recognition stopped")
    }

    // MARK: - Audio Level

    /// Get current audio level for visualization (0.0 to 1.0)
    func currentAudioLevel() -> Float {
        guard isRecording else { return 0 }

        // TODO: Implement accurate audio level metering
        // - Use AVAudioEngine's inputNode to get audio levels
        // - Process audio buffer for RMS or peak level
        // - Normalize to 0.0-1.0 range

        return 0.0
    }
}

// MARK: - Errors

enum SpeechError: LocalizedError {
    case recognizerNotAvailable
    case notAuthorized
    case requestCreationFailed
    case audioSessionFailed

    var errorDescription: String? {
        switch self {
        case .recognizerNotAvailable: return "Speech recognizer is not available"
        case .notAuthorized: return "Speech recognition not authorized"
        case .requestCreationFailed: return "Failed to create recognition request"
        case .audioSessionFailed: return "Failed to configure audio session"
        }
    }
}
