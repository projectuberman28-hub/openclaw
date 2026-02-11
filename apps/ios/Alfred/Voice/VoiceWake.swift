import Foundation
import Speech
import AVFoundation

/// Wake word detection for "Hey Alfred" using on-device Speech framework.
/// Continuously monitors audio input for the trigger phrase.
final class VoiceWake: ObservableObject {
    // MARK: - Published State

    @Published var isListening: Bool = false
    @Published var isEnabled: Bool = false
    @Published var lastDetection: Date? = nil

    // MARK: - Properties

    private var audioEngine: AVAudioEngine?
    private var speechRecognizer: SFSpeechRecognizer?
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private let logger = AlfredLogger.voice

    /// The wake phrase to detect
    let wakePhrase = "hey alfred"

    /// Callback when wake word is detected
    var onWakeWordDetected: (() -> Void)?

    /// Cooldown period to prevent rapid re-triggers (seconds)
    private let cooldownInterval: TimeInterval = 3.0
    private var lastTriggerTime: Date = .distantPast

    // TODO: Picovoice Porcupine integration for more efficient wake word detection
    // Porcupine uses a lightweight always-on model specifically designed for wake words,
    // which is more battery-efficient than continuous speech recognition.
    // Import PorcupineManager and use a custom "Hey Alfred" keyword file.
    //
    // private var porcupineManager: PorcupineManager?
    //
    // func startPorcupine() throws {
    //     let keywordPath = Bundle.main.path(forResource: "hey-alfred", ofType: "ppn")!
    //     porcupineManager = try PorcupineManager(
    //         accessKey: "<PICOVOICE_ACCESS_KEY>",
    //         keywordPath: keywordPath,
    //         onDetection: { [weak self] _ in
    //             self?.handleWakeWordDetected()
    //         }
    //     )
    //     try porcupineManager?.start()
    // }

    // MARK: - Init

    init() {
        speechRecognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    }

    // MARK: - Start Listening

    /// Start continuous listening for wake word
    func startListening() throws {
        guard !isListening else { return }

        guard let speechRecognizer = speechRecognizer, speechRecognizer.isAvailable else {
            throw WakeWordError.recognizerNotAvailable
        }

        // Configure audio session for background listening
        let audioSession = AVAudioSession.sharedInstance()
        try audioSession.setCategory(.record, mode: .measurement, options: [.duckOthers, .allowBluetooth])
        try audioSession.setActive(true, options: .notifyOthersOnDeactivation)

        startRecognitionCycle()

        isListening = true
        isEnabled = true
        logger.info("Wake word detection started")
    }

    /// Start a single recognition cycle (auto-restarts on completion)
    private func startRecognitionCycle() {
        // Cancel any existing task
        recognitionTask?.cancel()
        recognitionTask = nil

        // Create new request
        recognitionRequest = SFSpeechAudioBufferRecognitionRequest()

        guard let recognitionRequest = recognitionRequest else {
            logger.error("Failed to create recognition request")
            return
        }

        recognitionRequest.requiresOnDeviceRecognition = true
        recognitionRequest.shouldReportPartialResults = true

        // Create audio engine
        audioEngine = AVAudioEngine()

        guard let audioEngine = audioEngine else { return }

        let inputNode = audioEngine.inputNode
        let recordingFormat = inputNode.outputFormat(forBus: 0)

        inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { [weak self] buffer, _ in
            self?.recognitionRequest?.append(buffer)
        }

        // Start recognition task
        recognitionTask = speechRecognizer?.recognitionTask(with: recognitionRequest) { [weak self] result, error in
            guard let self = self else { return }

            if let result = result {
                let transcription = result.bestTranscription.formattedString.lowercased()

                // Check for wake phrase
                if transcription.contains(self.wakePhrase) {
                    self.handleWakeWordDetected()
                }
            }

            if error != nil || (result?.isFinal ?? false) {
                // Restart recognition cycle for continuous listening
                self.audioEngine?.stop()
                self.audioEngine?.inputNode.removeTap(onBus: 0)

                if self.isEnabled {
                    // Small delay before restarting to prevent tight loops
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                        if self.isEnabled {
                            self.startRecognitionCycle()
                        }
                    }
                }
            }
        }

        audioEngine.prepare()
        do {
            try audioEngine.start()
        } catch {
            logger.error("Audio engine failed to start: \(error.localizedDescription)")
        }
    }

    // MARK: - Handle Detection

    private func handleWakeWordDetected() {
        let now = Date()
        guard now.timeIntervalSince(lastTriggerTime) > cooldownInterval else {
            return // Still in cooldown
        }

        lastTriggerTime = now
        logger.info("Wake word detected: \"\(wakePhrase)\"")

        DispatchQueue.main.async {
            self.lastDetection = now

            // Haptic feedback
            let generator = UINotificationFeedbackGenerator()
            generator.notificationOccurred(.success)

            // Notify listener
            self.onWakeWordDetected?()
        }
    }

    // MARK: - Stop Listening

    /// Stop wake word detection
    func stopListening() {
        audioEngine?.stop()
        audioEngine?.inputNode.removeTap(onBus: 0)
        audioEngine = nil

        recognitionRequest?.endAudio()
        recognitionRequest = nil
        recognitionTask?.cancel()
        recognitionTask = nil

        isListening = false
        isEnabled = false
        logger.info("Wake word detection stopped")
    }

    // MARK: - Toggle

    /// Toggle wake word detection on/off
    func toggle() {
        if isListening {
            stopListening()
        } else {
            do {
                try startListening()
            } catch {
                logger.error("Failed to start wake word detection: \(error.localizedDescription)")
            }
        }
    }
}

// MARK: - Errors

enum WakeWordError: LocalizedError {
    case recognizerNotAvailable
    case audioSessionFailed
    case notAuthorized

    var errorDescription: String? {
        switch self {
        case .recognizerNotAvailable: return "Speech recognizer not available"
        case .audioSessionFailed: return "Failed to configure audio session"
        case .notAuthorized: return "Microphone access not authorized"
        }
    }
}
