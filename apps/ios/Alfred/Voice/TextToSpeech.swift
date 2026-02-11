import Foundation
import AVFoundation

/// Text-to-speech using AVSpeechSynthesizer.
/// Supports configurable voice, rate, pitch, and queue management.
final class TextToSpeech: NSObject, ObservableObject {
    // MARK: - Published State

    @Published var isSpeaking: Bool = false
    @Published var isPaused: Bool = false
    @Published var progress: Double = 0.0

    // MARK: - Properties

    private let synthesizer = AVSpeechSynthesizer()
    private let logger = AlfredLogger.voice

    // Configuration
    var voiceIdentifier: String? = nil  // nil = system default
    var rate: Float = AVSpeechUtteranceDefaultSpeechRate
    var pitchMultiplier: Float = 1.0
    var volume: Float = 1.0

    // Queue management
    private var utteranceQueue: [String] = []
    private var currentUtteranceIndex: Int = 0
    private var totalUtterances: Int = 0

    // MARK: - Init

    override init() {
        super.init()
        synthesizer.delegate = self
        configureAudioSession()
    }

    // MARK: - Audio Session

    private func configureAudioSession() {
        do {
            let audioSession = AVAudioSession.sharedInstance()
            try audioSession.setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
            try audioSession.setActive(true)
        } catch {
            logger.error("Failed to configure audio session: \(error.localizedDescription)")
        }
    }

    // MARK: - Speak

    /// Speak the given text
    func speak(_ text: String) {
        stop()

        // Split long text into manageable chunks for better queue management
        let chunks = splitIntoChunks(text, maxLength: 500)
        utteranceQueue = chunks
        totalUtterances = chunks.count
        currentUtteranceIndex = 0

        speakNextChunk()
    }

    /// Queue additional text to speak after current utterance
    func enqueue(_ text: String) {
        let chunks = splitIntoChunks(text, maxLength: 500)
        utteranceQueue.append(contentsOf: chunks)
        totalUtterances += chunks.count

        // If not currently speaking, start
        if !isSpeaking {
            speakNextChunk()
        }
    }

    private func speakNextChunk() {
        guard currentUtteranceIndex < utteranceQueue.count else {
            isSpeaking = false
            progress = 1.0
            return
        }

        let text = utteranceQueue[currentUtteranceIndex]
        let utterance = AVSpeechUtterance(string: text)

        // Apply configuration
        utterance.rate = rate
        utterance.pitchMultiplier = pitchMultiplier
        utterance.volume = volume
        utterance.preUtteranceDelay = 0.1
        utterance.postUtteranceDelay = 0.1

        // Set voice
        if let identifier = voiceIdentifier,
           let voice = AVSpeechSynthesisVoice(identifier: identifier) {
            utterance.voice = voice
        } else {
            // Default to enhanced English voice if available
            utterance.voice = AVSpeechSynthesisVoice(language: "en-US")
        }

        synthesizer.speak(utterance)
        isSpeaking = true
        isPaused = false

        logger.debug("Speaking chunk \(currentUtteranceIndex + 1)/\(totalUtterances)")
    }

    // MARK: - Pause / Resume

    /// Pause speech playback
    func pause() {
        guard isSpeaking, !isPaused else { return }
        synthesizer.pauseSpeaking(at: .word)
        isPaused = true
        logger.debug("Speech paused")
    }

    /// Resume paused speech
    func resume() {
        guard isPaused else { return }
        synthesizer.continueSpeaking()
        isPaused = false
        logger.debug("Speech resumed")
    }

    /// Toggle pause/resume
    func togglePause() {
        if isPaused {
            resume()
        } else {
            pause()
        }
    }

    // MARK: - Stop

    /// Stop all speech and clear the queue
    func stop() {
        synthesizer.stopSpeaking(at: .immediate)
        utteranceQueue.removeAll()
        currentUtteranceIndex = 0
        totalUtterances = 0
        isSpeaking = false
        isPaused = false
        progress = 0.0
        logger.debug("Speech stopped")
    }

    // MARK: - Available Voices

    /// Get all available voices for a language
    static func availableVoices(for language: String = "en-US") -> [AVSpeechSynthesisVoice] {
        return AVSpeechSynthesisVoice.speechVoices().filter { $0.language == language }
    }

    /// Get all available languages
    static var availableLanguages: [String] {
        return Array(Set(AVSpeechSynthesisVoice.speechVoices().map { $0.language })).sorted()
    }

    // MARK: - Helpers

    /// Split text into chunks at sentence boundaries
    private func splitIntoChunks(_ text: String, maxLength: Int) -> [String] {
        guard text.count > maxLength else { return [text] }

        var chunks: [String] = []
        var currentChunk = ""

        // Split by sentences
        text.enumerateSubstrings(in: text.startIndex..., options: .bySentences) { substring, _, _, _ in
            guard let sentence = substring else { return }

            if currentChunk.count + sentence.count > maxLength {
                if !currentChunk.isEmpty {
                    chunks.append(currentChunk.trimmingCharacters(in: .whitespaces))
                }
                currentChunk = sentence
            } else {
                currentChunk += sentence
            }
        }

        if !currentChunk.isEmpty {
            chunks.append(currentChunk.trimmingCharacters(in: .whitespaces))
        }

        return chunks.isEmpty ? [text] : chunks
    }
}

// MARK: - AVSpeechSynthesizerDelegate

extension TextToSpeech: AVSpeechSynthesizerDelegate {
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        currentUtteranceIndex += 1
        progress = totalUtterances > 0 ? Double(currentUtteranceIndex) / Double(totalUtterances) : 0

        // Speak next chunk in queue
        speakNextChunk()
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        isSpeaking = false
        isPaused = false
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didPause utterance: AVSpeechUtterance) {
        isPaused = true
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didContinue utterance: AVSpeechUtterance) {
        isPaused = false
    }
}
