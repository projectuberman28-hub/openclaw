import SwiftUI
import AVFoundation

/// Camera capture using AVCaptureSession with SwiftUI preview.
/// Supports photo and video capture with permission handling.
final class CameraCapture: NSObject, ObservableObject {
    // MARK: - Published State

    @Published var isAuthorized: Bool = false
    @Published var isCaptureActive: Bool = false
    @Published var capturedImage: UIImage? = nil
    @Published var errorMessage: String? = nil
    @Published var currentPosition: AVCaptureDevice.Position = .back

    // MARK: - Properties

    let captureSession = AVCaptureSession()
    private var photoOutput = AVCapturePhotoOutput()
    private var videoOutput = AVCaptureMovieFileOutput()
    private var currentInput: AVCaptureDeviceInput?
    private let logger = AlfredLogger.camera

    private var photoContinuation: CheckedContinuation<UIImage, Error>?

    // MARK: - Init

    override init() {
        super.init()
        checkPermission()
    }

    // MARK: - Permission

    func checkPermission() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            isAuthorized = true
            setupSession()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                DispatchQueue.main.async {
                    self?.isAuthorized = granted
                    if granted {
                        self?.setupSession()
                    }
                }
            }
        case .denied, .restricted:
            isAuthorized = false
            logger.warning("Camera permission denied or restricted")
        @unknown default:
            isAuthorized = false
        }
    }

    // MARK: - Session Setup

    private func setupSession() {
        captureSession.beginConfiguration()
        captureSession.sessionPreset = .photo

        // Add video input
        guard let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) else {
            logger.error("No camera device available")
            captureSession.commitConfiguration()
            return
        }

        do {
            let input = try AVCaptureDeviceInput(device: camera)
            if captureSession.canAddInput(input) {
                captureSession.addInput(input)
                currentInput = input
            }
        } catch {
            logger.error("Failed to create camera input: \(error.localizedDescription)")
            captureSession.commitConfiguration()
            return
        }

        // Add photo output
        if captureSession.canAddOutput(photoOutput) {
            captureSession.addOutput(photoOutput)
            photoOutput.isHighResolutionCaptureEnabled = true
        }

        // Add video output
        if captureSession.canAddOutput(videoOutput) {
            captureSession.addOutput(videoOutput)
        }

        captureSession.commitConfiguration()
        logger.info("Camera session configured")
    }

    // MARK: - Start / Stop

    func startCapture() {
        guard !captureSession.isRunning else { return }

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            self?.captureSession.startRunning()
            DispatchQueue.main.async {
                self?.isCaptureActive = true
                self?.logger.info("Camera capture started")
            }
        }
    }

    func stopCapture() {
        guard captureSession.isRunning else { return }

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            self?.captureSession.stopRunning()
            DispatchQueue.main.async {
                self?.isCaptureActive = false
                self?.logger.info("Camera capture stopped")
            }
        }
    }

    // MARK: - Switch Camera

    func switchCamera() {
        captureSession.beginConfiguration()

        // Remove current input
        if let currentInput = currentInput {
            captureSession.removeInput(currentInput)
        }

        // Toggle position
        let newPosition: AVCaptureDevice.Position = (currentPosition == .back) ? .front : .back

        guard let newCamera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: newPosition) else {
            logger.error("Camera not available for position: \(newPosition.rawValue)")
            captureSession.commitConfiguration()
            return
        }

        do {
            let newInput = try AVCaptureDeviceInput(device: newCamera)
            if captureSession.canAddInput(newInput) {
                captureSession.addInput(newInput)
                currentInput = newInput
                currentPosition = newPosition
            }
        } catch {
            logger.error("Failed to switch camera: \(error.localizedDescription)")
        }

        captureSession.commitConfiguration()
    }

    // MARK: - Take Photo

    func takePhoto() async throws -> UIImage {
        return try await withCheckedThrowingContinuation { continuation in
            self.photoContinuation = continuation

            let settings = AVCapturePhotoSettings()
            settings.isHighResolutionPhotoEnabled = true

            photoOutput.capturePhoto(with: settings, delegate: self)
        }
    }

    // MARK: - Record Video

    func startRecording(to url: URL) {
        guard !videoOutput.isRecording else { return }
        videoOutput.startRecording(to: url, recordingDelegate: self)
        logger.info("Video recording started")
    }

    func stopRecording() {
        guard videoOutput.isRecording else { return }
        videoOutput.stopRecording()
        logger.info("Video recording stopped")
    }
}

// MARK: - AVCapturePhotoCaptureDelegate

extension CameraCapture: AVCapturePhotoCaptureDelegate {
    func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        if let error = error {
            logger.error("Photo capture error: \(error.localizedDescription)")
            photoContinuation?.resume(throwing: error)
            photoContinuation = nil
            return
        }

        guard let imageData = photo.fileDataRepresentation(),
              let image = UIImage(data: imageData) else {
            logger.error("Failed to create image from photo data")
            photoContinuation?.resume(throwing: CameraCaptureError.imageCreationFailed)
            photoContinuation = nil
            return
        }

        DispatchQueue.main.async {
            self.capturedImage = image
        }

        photoContinuation?.resume(returning: image)
        photoContinuation = nil
        logger.info("Photo captured successfully")
    }
}

// MARK: - AVCaptureFileOutputRecordingDelegate

extension CameraCapture: AVCaptureFileOutputRecordingDelegate {
    func fileOutput(_ output: AVCaptureFileOutput, didFinishRecordingTo outputFileURL: URL, from connections: [AVCaptureConnection], error: Error?) {
        if let error = error {
            logger.error("Video recording error: \(error.localizedDescription)")
        } else {
            logger.info("Video saved to: \(outputFileURL.path)")
        }
    }
}

// MARK: - Camera Preview (SwiftUI)

struct CameraPreview: UIViewRepresentable {
    let session: AVCaptureSession

    func makeUIView(context: Context) -> UIView {
        let view = UIView(frame: .zero)

        let previewLayer = AVCaptureVideoPreviewLayer(session: session)
        previewLayer.videoGravity = .resizeAspectFill
        view.layer.addSublayer(previewLayer)

        context.coordinator.previewLayer = previewLayer
        return view
    }

    func updateUIView(_ uiView: UIView, context: Context) {
        context.coordinator.previewLayer?.frame = uiView.bounds
    }

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    class Coordinator {
        var previewLayer: AVCaptureVideoPreviewLayer?
    }
}

// MARK: - Camera View (SwiftUI)

struct CameraView: View {
    @StateObject private var camera = CameraCapture()
    @Environment(\.dismiss) private var dismiss

    var onCapture: ((UIImage) -> Void)?

    var body: some View {
        ZStack {
            if camera.isAuthorized {
                CameraPreview(session: camera.captureSession)
                    .ignoresSafeArea()

                VStack {
                    // Top bar
                    HStack {
                        Button(action: { dismiss() }) {
                            Image(systemName: "xmark")
                                .font(.system(size: 20, weight: .bold))
                                .foregroundColor(.white)
                                .padding(12)
                                .background(Color.black.opacity(0.5))
                                .clipShape(Circle())
                        }

                        Spacer()

                        Button(action: { camera.switchCamera() }) {
                            Image(systemName: "camera.rotate")
                                .font(.system(size: 20))
                                .foregroundColor(.white)
                                .padding(12)
                                .background(Color.black.opacity(0.5))
                                .clipShape(Circle())
                        }
                    }
                    .padding()

                    Spacer()

                    // Capture button
                    Button(action: capturePhoto) {
                        ZStack {
                            Circle()
                                .stroke(.white, lineWidth: 4)
                                .frame(width: 72, height: 72)

                            Circle()
                                .fill(.white)
                                .frame(width: 60, height: 60)
                        }
                    }
                    .padding(.bottom, 40)
                }
            } else {
                VStack(spacing: 16) {
                    Image(systemName: "camera.fill")
                        .font(.system(size: 48))
                        .foregroundColor(BatcaveTheme.textMuted)

                    Text("Camera access required")
                        .font(AlfredFont.headline)
                        .foregroundColor(BatcaveTheme.textSecondary)

                    Button("Open Settings") {
                        if let url = URL(string: UIApplication.openSettingsURLString) {
                            UIApplication.shared.open(url)
                        }
                    }
                    .foregroundColor(BatcaveTheme.accent)
                }
            }
        }
        .onAppear { camera.startCapture() }
        .onDisappear { camera.stopCapture() }
    }

    private func capturePhoto() {
        Task {
            do {
                let image = try await camera.takePhoto()
                onCapture?(image)
                dismiss()
            } catch {
                AlfredLogger.camera.error("Capture failed: \(error.localizedDescription)")
            }
        }
    }
}

// MARK: - Errors

enum CameraCaptureError: LocalizedError {
    case notAuthorized
    case deviceNotAvailable
    case imageCreationFailed
    case recordingFailed

    var errorDescription: String? {
        switch self {
        case .notAuthorized: return "Camera access not authorized"
        case .deviceNotAvailable: return "Camera device not available"
        case .imageCreationFailed: return "Failed to create image from capture"
        case .recordingFailed: return "Video recording failed"
        }
    }
}
