import SwiftUI

/// Full-screen voice interaction view with push-to-talk,
/// waveform visualization, and transcription display.
struct TalkMode: View {
    @EnvironmentObject var appState: AppState
    @StateObject private var speechRecognizer = SpeechRecognizer()
    @StateObject private var tts = TextToSpeech()
    @StateObject private var wakeWord = VoiceWake()

    @State private var isRecording = false
    @State private var audioLevel: CGFloat = 0.0
    @State private var responseText: String = ""
    @State private var showSettings = false

    // Animation timer for waveform
    @State private var wavePhase: CGFloat = 0

    var body: some View {
        NavigationView {
            ZStack {
                BatcaveTheme.primaryBg.ignoresSafeArea()

                VStack(spacing: 32) {
                    Spacer()

                    // Status indicator
                    statusIndicator

                    // Waveform visualization
                    waveformView
                        .frame(height: 100)

                    // Transcription display
                    transcriptionView

                    // Response display
                    if !responseText.isEmpty {
                        responseView
                    }

                    Spacer()

                    // Push-to-talk button
                    pushToTalkButton

                    // TTS controls
                    if tts.isSpeaking {
                        ttsControls
                    }

                    // Wake word toggle
                    wakeWordToggle
                        .padding(.bottom, 20)
                }
                .padding(.horizontal, 24)
            }
            .navigationTitle("Voice")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: { showSettings = true }) {
                        Image(systemName: "slider.horizontal.3")
                            .foregroundColor(BatcaveTheme.textSecondary)
                    }
                }
            }
            .sheet(isPresented: $showSettings) {
                voiceSettingsSheet
            }
            .onAppear {
                setupWakeWord()
            }
        }
        .navigationViewStyle(StackNavigationViewStyle())
    }

    // MARK: - Status Indicator

    private var statusIndicator: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(statusColor)
                .frame(width: 8, height: 8)

            Text(statusText)
                .font(AlfredFont.caption)
                .foregroundColor(BatcaveTheme.textSecondary)
        }
    }

    private var statusColor: Color {
        if isRecording { return BatcaveTheme.accent }
        if wakeWord.isListening { return BatcaveTheme.success }
        return BatcaveTheme.textMuted
    }

    private var statusText: String {
        if isRecording { return "Listening..." }
        if tts.isSpeaking { return "Speaking..." }
        if wakeWord.isListening { return "Waiting for \"Hey Alfred\"" }
        return "Tap to speak"
    }

    // MARK: - Waveform Visualization

    private var waveformView: some View {
        GeometryReader { geometry in
            ZStack {
                // Background waveform bars
                HStack(spacing: 3) {
                    ForEach(0..<30, id: \.self) { i in
                        RoundedRectangle(cornerRadius: 2)
                            .fill(isRecording ? BatcaveTheme.accent : BatcaveTheme.tertiaryBg)
                            .frame(width: 4, height: barHeight(index: i, width: geometry.size.width))
                            .animation(
                                .easeInOut(duration: 0.15).delay(Double(i) * 0.02),
                                value: isRecording
                            )
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .onReceive(Timer.publish(every: 0.1, on: .main, in: .common).autoconnect()) { _ in
            if isRecording {
                withAnimation(.easeInOut(duration: 0.1)) {
                    wavePhase += 0.3
                    audioLevel = CGFloat.random(in: 0.1...0.9)
                }
            } else {
                audioLevel = 0
            }
        }
    }

    private func barHeight(index: Int, width: CGFloat) -> CGFloat {
        guard isRecording else { return 8 }
        let normalizedIndex = CGFloat(index) / 30.0
        let wave = sin(normalizedIndex * .pi * 2 + wavePhase) * 0.5 + 0.5
        let level = audioLevel * wave
        return max(8, level * 80)
    }

    // MARK: - Transcription Display

    private var transcriptionView: some View {
        VStack(spacing: 8) {
            if !speechRecognizer.transcription.isEmpty {
                Text(speechRecognizer.transcription)
                    .font(AlfredFont.inter(18))
                    .foregroundColor(BatcaveTheme.textPrimary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 20)
                    .transition(.opacity)
            } else if isRecording {
                Text("Speak now...")
                    .font(AlfredFont.inter(18))
                    .foregroundColor(BatcaveTheme.textMuted)
                    .italic()
            }
        }
        .frame(minHeight: 60)
    }

    // MARK: - Response Display

    private var responseView: some View {
        ScrollView {
            Text(responseText)
                .font(AlfredFont.body)
                .foregroundColor(BatcaveTheme.textSecondary)
                .padding()
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxHeight: 150)
        .background(BatcaveTheme.secondaryBg)
        .cornerRadius(12)
    }

    // MARK: - Push-to-Talk Button

    private var pushToTalkButton: some View {
        Button(action: {}) {
            ZStack {
                // Outer ring (animated when recording)
                Circle()
                    .stroke(
                        isRecording ? BatcaveTheme.accent : BatcaveTheme.border,
                        lineWidth: 3
                    )
                    .frame(width: 100, height: 100)
                    .scaleEffect(isRecording ? 1.15 : 1.0)
                    .opacity(isRecording ? 0.6 : 1.0)
                    .animation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true), value: isRecording)

                // Inner circle
                Circle()
                    .fill(isRecording ? BatcaveTheme.accent : BatcaveTheme.tertiaryBg)
                    .frame(width: 80, height: 80)

                // Microphone icon
                Image(systemName: isRecording ? "stop.fill" : "mic.fill")
                    .font(.system(size: 30))
                    .foregroundColor(isRecording ? .white : BatcaveTheme.accent)
            }
        }
        .simultaneousGesture(
            LongPressGesture(minimumDuration: 0.1)
                .onChanged { _ in
                    startRecording()
                }
        )
        .simultaneousGesture(
            DragGesture(minimumDistance: 0)
                .onEnded { _ in
                    if isRecording {
                        stopRecording()
                    }
                }
        )
        .onTapGesture {
            toggleRecording()
        }
    }

    // MARK: - TTS Controls

    private var ttsControls: some View {
        HStack(spacing: 24) {
            Button(action: { tts.stop() }) {
                Image(systemName: "stop.circle")
                    .font(.system(size: 24))
                    .foregroundColor(BatcaveTheme.textSecondary)
            }

            Button(action: { tts.togglePause() }) {
                Image(systemName: tts.isPaused ? "play.circle" : "pause.circle")
                    .font(.system(size: 24))
                    .foregroundColor(BatcaveTheme.textSecondary)
            }

            // Progress indicator
            ProgressView(value: tts.progress)
                .progressViewStyle(LinearProgressViewStyle(tint: BatcaveTheme.accent))
                .frame(width: 100)
        }
        .padding(.vertical, 8)
    }

    // MARK: - Wake Word Toggle

    private var wakeWordToggle: some View {
        HStack {
            Image(systemName: wakeWord.isListening ? "ear.fill" : "ear")
                .foregroundColor(wakeWord.isListening ? BatcaveTheme.success : BatcaveTheme.textMuted)

            Text("\"Hey Alfred\" wake word")
                .font(AlfredFont.caption)
                .foregroundColor(BatcaveTheme.textSecondary)

            Toggle("", isOn: Binding(
                get: { wakeWord.isListening },
                set: { _ in wakeWord.toggle() }
            ))
            .toggleStyle(SwitchToggleStyle(tint: BatcaveTheme.accent))
            .labelsHidden()
        }
    }

    // MARK: - Voice Settings Sheet

    private var voiceSettingsSheet: some View {
        NavigationView {
            List {
                Section("Speech Rate") {
                    Slider(value: Binding(
                        get: { Double(tts.rate) },
                        set: { tts.rate = Float($0) }
                    ), in: 0.1...1.0, step: 0.1)
                    .listRowBackground(BatcaveTheme.secondaryBg)
                }

                Section("Pitch") {
                    Slider(value: Binding(
                        get: { Double(tts.pitchMultiplier) },
                        set: { tts.pitchMultiplier = Float($0) }
                    ), in: 0.5...2.0, step: 0.1)
                    .listRowBackground(BatcaveTheme.secondaryBg)
                }
            }
            .scrollContentBackground(.hidden)
            .background(BatcaveTheme.primaryBg)
            .navigationTitle("Voice Settings")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    // MARK: - Recording Control

    private func setupWakeWord() {
        wakeWord.onWakeWordDetected = { [self] in
            startRecording()
        }
    }

    private func toggleRecording() {
        if isRecording {
            stopRecording()
        } else {
            startRecording()
        }
    }

    private func startRecording() {
        guard !isRecording else { return }

        // Stop TTS if playing
        tts.stop()

        do {
            try speechRecognizer.startRecording()
            isRecording = true

            // Haptic feedback
            let generator = UIImpactFeedbackGenerator(style: .medium)
            generator.impactOccurred()
        } catch {
            AlfredLogger.voice.error("Failed to start recording: \(error.localizedDescription)")
        }
    }

    private func stopRecording() {
        guard isRecording else { return }

        speechRecognizer.stopRecording()
        isRecording = false

        // Send transcription to Gateway
        let text = speechRecognizer.transcription
        if !text.isEmpty {
            sendVoiceMessage(text)
        }

        // Haptic feedback
        let generator = UIImpactFeedbackGenerator(style: .light)
        generator.impactOccurred()
    }

    private func sendVoiceMessage(_ text: String) {
        // TODO: Send via GatewayClient and handle streaming response
        // Task {
        //     try await GatewayClient.shared.sendChat(text)
        //     // Listen for response and play via TTS
        //     for await message in GatewayClient.shared.messages {
        //         if message.type == .done, let fullText = message.payload?.text {
        //             responseText = fullText
        //             tts.speak(fullText)
        //         }
        //     }
        // }

        responseText = "Voice message received: \"\(text)\""
    }
}

// MARK: - Preview

#if DEBUG
struct TalkMode_Previews: PreviewProvider {
    static var previews: some View {
        TalkMode()
            .environmentObject(AppState())
    }
}
#endif
