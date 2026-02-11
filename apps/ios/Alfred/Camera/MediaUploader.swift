import Foundation
import UIKit

/// Uploads captured media (images, video) to the Alfred Gateway.
/// Supports multipart form upload with progress tracking and compression.
final class MediaUploader: ObservableObject {
    // MARK: - Published State

    @Published var isUploading: Bool = false
    @Published var uploadProgress: Double = 0.0
    @Published var errorMessage: String? = nil

    // MARK: - Properties

    private let logger = AlfredLogger.camera
    private let pairingManager = PairingManager.shared
    private let authManager = AuthManager.shared

    /// Maximum image dimension before compression
    private let maxImageDimension: CGFloat = 2048

    /// JPEG compression quality (0.0 to 1.0)
    private let jpegQuality: CGFloat = 0.8

    // MARK: - Upload Image

    /// Upload a UIImage to the Gateway
    /// - Parameters:
    ///   - image: The image to upload
    ///   - sessionId: Chat session to associate with
    /// - Returns: Attachment info for referencing the uploaded file
    func uploadImage(_ image: UIImage, sessionId: String) async throws -> AttachmentInfo {
        guard let info = pairingManager.pairingInfo else {
            throw UploadError.notPaired
        }

        isUploading = true
        uploadProgress = 0.0
        errorMessage = nil

        defer {
            DispatchQueue.main.async {
                self.isUploading = false
            }
        }

        // Compress image
        let compressed = compressImage(image)
        guard let imageData = compressed.jpegData(compressionQuality: jpegQuality) else {
            throw UploadError.compressionFailed
        }

        logger.info("Uploading image: \(imageData.count) bytes")

        // Build upload URL
        let uploadURL = URL(string: "http://\(info.host):\(info.port)/api/upload")!

        // Create multipart form request
        let boundary = UUID().uuidString
        var request = URLRequest(url: uploadURL)
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        if let token = authManager.getToken() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        // Build multipart body
        let body = buildMultipartBody(
            data: imageData,
            fieldName: "file",
            fileName: "capture_\(Int(Date().timeIntervalSince1970)).jpg",
            mimeType: "image/jpeg",
            additionalFields: ["sessionId": sessionId],
            boundary: boundary
        )

        request.httpBody = body

        // Upload with progress tracking
        let (data, response) = try await uploadWithProgress(request: request, body: body)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
            throw UploadError.serverError(statusCode)
        }

        // Parse response
        let uploadResponse = try JSONDecoder().decode(UploadResponse.self, from: data)

        logger.info("Image uploaded successfully: \(uploadResponse.id)")

        return AttachmentInfo(
            id: uploadResponse.id,
            type: .image,
            name: uploadResponse.fileName,
            mimeType: "image/jpeg",
            size: Int64(imageData.count),
            url: uploadResponse.url
        )
    }

    // MARK: - Upload Video

    /// Upload a video file to the Gateway
    func uploadVideo(fileURL: URL, sessionId: String) async throws -> AttachmentInfo {
        guard let info = pairingManager.pairingInfo else {
            throw UploadError.notPaired
        }

        isUploading = true
        uploadProgress = 0.0
        errorMessage = nil

        defer {
            DispatchQueue.main.async {
                self.isUploading = false
            }
        }

        let videoData = try Data(contentsOf: fileURL)
        logger.info("Uploading video: \(videoData.count) bytes")

        let uploadURL = URL(string: "http://\(info.host):\(info.port)/api/upload")!

        let boundary = UUID().uuidString
        var request = URLRequest(url: uploadURL)
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        if let token = authManager.getToken() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let body = buildMultipartBody(
            data: videoData,
            fieldName: "file",
            fileName: fileURL.lastPathComponent,
            mimeType: "video/mp4",
            additionalFields: ["sessionId": sessionId],
            boundary: boundary
        )

        request.httpBody = body

        let (data, response) = try await uploadWithProgress(request: request, body: body)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
            throw UploadError.serverError(statusCode)
        }

        let uploadResponse = try JSONDecoder().decode(UploadResponse.self, from: data)

        logger.info("Video uploaded successfully: \(uploadResponse.id)")

        return AttachmentInfo(
            id: uploadResponse.id,
            type: .video,
            name: uploadResponse.fileName,
            mimeType: "video/mp4",
            size: Int64(videoData.count),
            url: uploadResponse.url
        )
    }

    // MARK: - Image Compression

    /// Compress and resize image before upload
    private func compressImage(_ image: UIImage) -> UIImage {
        let size = image.size

        // Check if resizing is needed
        guard size.width > maxImageDimension || size.height > maxImageDimension else {
            return image
        }

        let ratio = min(maxImageDimension / size.width, maxImageDimension / size.height)
        let newSize = CGSize(width: size.width * ratio, height: size.height * ratio)

        let renderer = UIGraphicsImageRenderer(size: newSize)
        let resized = renderer.image { _ in
            image.draw(in: CGRect(origin: .zero, size: newSize))
        }

        logger.debug("Image resized from \(size) to \(newSize)")
        return resized
    }

    // MARK: - Multipart Form Body

    private func buildMultipartBody(
        data: Data,
        fieldName: String,
        fileName: String,
        mimeType: String,
        additionalFields: [String: String],
        boundary: String
    ) -> Data {
        var body = Data()

        // Add text fields
        for (key, value) in additionalFields {
            body.append("--\(boundary)\r\n".data(using: .utf8)!)
            body.append("Content-Disposition: form-data; name=\"\(key)\"\r\n\r\n".data(using: .utf8)!)
            body.append("\(value)\r\n".data(using: .utf8)!)
        }

        // Add file data
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"\(fieldName)\"; filename=\"\(fileName)\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: \(mimeType)\r\n\r\n".data(using: .utf8)!)
        body.append(data)
        body.append("\r\n".data(using: .utf8)!)

        // Close boundary
        body.append("--\(boundary)--\r\n".data(using: .utf8)!)

        return body
    }

    // MARK: - Upload with Progress

    private func uploadWithProgress(request: URLRequest, body: Data) async throws -> (Data, URLResponse) {
        // TODO: Implement progress tracking with URLSessionUploadTask delegate
        // For now, use simple URLSession upload
        let (data, response) = try await URLSession.shared.data(for: request)

        await MainActor.run {
            self.uploadProgress = 1.0
        }

        return (data, response)
    }
}

// MARK: - Upload Response

struct UploadResponse: Codable {
    let id: String
    let fileName: String
    let url: String?
    let size: Int64?
}

// MARK: - Errors

enum UploadError: LocalizedError {
    case notPaired
    case compressionFailed
    case serverError(Int)
    case networkError(String)

    var errorDescription: String? {
        switch self {
        case .notPaired: return "Not paired with a Gateway"
        case .compressionFailed: return "Failed to compress media"
        case .serverError(let code): return "Server error (HTTP \(code))"
        case .networkError(let msg): return "Network error: \(msg)"
        }
    }
}
