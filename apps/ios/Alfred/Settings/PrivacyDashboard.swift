import SwiftUI

/// Privacy dashboard showing privacy score, cloud call counts,
/// PII detection stats, and audit log.
struct PrivacyDashboard: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var viewModel = PrivacyDashboardViewModel()

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 20) {
                    // Privacy score card
                    privacyScoreCard

                    // Stats grid
                    statsGrid

                    // PII detection section
                    piiSection

                    // Audit log
                    auditLogSection
                }
                .padding()
            }
            .background(BatcaveTheme.primaryBg)
            .navigationTitle("Privacy Dashboard")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") { dismiss() }
                        .foregroundColor(BatcaveTheme.accent)
                }
            }
            .onAppear {
                viewModel.refresh()
            }
        }
    }

    // MARK: - Privacy Score Card

    private var privacyScoreCard: some View {
        VStack(spacing: 16) {
            // Score circle
            ZStack {
                Circle()
                    .stroke(BatcaveTheme.border, lineWidth: 8)
                    .frame(width: 120, height: 120)

                Circle()
                    .trim(from: 0, to: CGFloat(viewModel.privacyScore) / 100.0)
                    .stroke(scoreColor, style: StrokeStyle(lineWidth: 8, lineCap: .round))
                    .frame(width: 120, height: 120)
                    .rotationEffect(.degrees(-90))
                    .animation(.easeInOut(duration: 0.8), value: viewModel.privacyScore)

                VStack(spacing: 2) {
                    Text("\(viewModel.privacyScore)")
                        .font(AlfredFont.inter(36, weight: .bold))
                        .foregroundColor(BatcaveTheme.textPrimary)

                    Text("/ 100")
                        .font(AlfredFont.caption)
                        .foregroundColor(BatcaveTheme.textMuted)
                }
            }

            Text("Privacy Score")
                .font(AlfredFont.headline)
                .foregroundColor(BatcaveTheme.textPrimary)

            Text(viewModel.privacyDescription)
                .font(AlfredFont.body)
                .foregroundColor(BatcaveTheme.textSecondary)
                .multilineTextAlignment(.center)
        }
        .batcaveCard()
    }

    private var scoreColor: Color {
        if viewModel.privacyScore >= 80 { return BatcaveTheme.success }
        if viewModel.privacyScore >= 50 { return BatcaveTheme.warning }
        return BatcaveTheme.error
    }

    // MARK: - Stats Grid

    private var statsGrid: some View {
        LazyVGrid(columns: [
            GridItem(.flexible()),
            GridItem(.flexible())
        ], spacing: 12) {
            statCard(
                title: "Local Calls",
                value: "\(viewModel.localCallCount)",
                icon: "lock.fill",
                color: BatcaveTheme.localOnly
            )

            statCard(
                title: "Cloud Calls",
                value: "\(viewModel.cloudCallCount)",
                icon: "cloud.fill",
                color: BatcaveTheme.cloudCall
            )

            statCard(
                title: "PII Blocked",
                value: "\(viewModel.piiBlockedCount)",
                icon: "eye.slash.fill",
                color: BatcaveTheme.accent
            )

            statCard(
                title: "Sessions",
                value: "\(viewModel.totalSessions)",
                icon: "bubble.left.fill",
                color: BatcaveTheme.info
            )
        }
    }

    private func statCard(title: String, value: String, icon: String, color: Color) -> some View {
        VStack(spacing: 8) {
            Image(systemName: icon)
                .font(.system(size: 24))
                .foregroundColor(color)

            Text(value)
                .font(AlfredFont.inter(28, weight: .bold))
                .foregroundColor(BatcaveTheme.textPrimary)

            Text(title)
                .font(AlfredFont.caption)
                .foregroundColor(BatcaveTheme.textSecondary)
        }
        .frame(maxWidth: .infinity)
        .padding()
        .background(BatcaveTheme.secondaryBg)
        .cornerRadius(12)
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(BatcaveTheme.border, lineWidth: 1)
        )
    }

    // MARK: - PII Detection Section

    private var piiSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Image(systemName: "shield.checkered")
                    .foregroundColor(BatcaveTheme.accent)
                Text("PII Detection")
                    .font(AlfredFont.headline)
                    .foregroundColor(BatcaveTheme.textPrimary)
            }

            if viewModel.piiDetections.isEmpty {
                HStack {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundColor(BatcaveTheme.success)
                    Text("No PII detected in recent conversations")
                        .font(AlfredFont.body)
                        .foregroundColor(BatcaveTheme.textSecondary)
                }
                .padding()
            } else {
                ForEach(viewModel.piiDetections) { detection in
                    HStack {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundColor(BatcaveTheme.warning)
                            .font(.system(size: 14))

                        VStack(alignment: .leading, spacing: 2) {
                            Text(detection.type)
                                .font(AlfredFont.interMedium(14))
                                .foregroundColor(BatcaveTheme.textPrimary)

                            Text(detection.action)
                                .font(AlfredFont.caption)
                                .foregroundColor(BatcaveTheme.textMuted)
                        }

                        Spacer()

                        Text(detection.formattedDate)
                            .font(AlfredFont.caption)
                            .foregroundColor(BatcaveTheme.textMuted)
                    }
                    .padding(.vertical, 4)
                }
            }
        }
        .batcaveCard()
    }

    // MARK: - Audit Log

    private var auditLogSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Image(systemName: "doc.text.magnifyingglass")
                    .foregroundColor(BatcaveTheme.info)
                Text("Audit Log")
                    .font(AlfredFont.headline)
                    .foregroundColor(BatcaveTheme.textPrimary)

                Spacer()

                Button("Refresh") {
                    viewModel.refresh()
                }
                .font(AlfredFont.caption)
                .foregroundColor(BatcaveTheme.accent)
            }

            if viewModel.auditEntries.isEmpty {
                Text("No audit entries yet")
                    .font(AlfredFont.body)
                    .foregroundColor(BatcaveTheme.textMuted)
                    .padding()
            } else {
                ForEach(viewModel.auditEntries) { entry in
                    HStack(spacing: 8) {
                        Circle()
                            .fill(entry.isLocal ? BatcaveTheme.localOnly : BatcaveTheme.cloudCall)
                            .frame(width: 8, height: 8)

                        VStack(alignment: .leading, spacing: 2) {
                            Text(entry.action)
                                .font(AlfredFont.body)
                                .foregroundColor(BatcaveTheme.textPrimary)
                                .lineLimit(1)

                            Text(entry.formattedDate)
                                .font(AlfredFont.caption)
                                .foregroundColor(BatcaveTheme.textMuted)
                        }

                        Spacer()

                        Text(entry.isLocal ? "Local" : "Cloud")
                            .font(AlfredFont.caption)
                            .foregroundColor(entry.isLocal ? BatcaveTheme.localOnly : BatcaveTheme.cloudCall)
                    }
                    .padding(.vertical, 2)

                    if entry.id != viewModel.auditEntries.last?.id {
                        Divider()
                            .background(BatcaveTheme.separator)
                    }
                }
            }
        }
        .batcaveCard()
    }
}

// MARK: - View Model

@MainActor
final class PrivacyDashboardViewModel: ObservableObject {
    @Published var privacyScore: Int = 95
    @Published var privacyDescription: String = "Your data is well protected. Most processing happens locally."

    @Published var localCallCount: Int = 0
    @Published var cloudCallCount: Int = 0
    @Published var piiBlockedCount: Int = 0
    @Published var totalSessions: Int = 0

    @Published var piiDetections: [PIIDetection] = []
    @Published var auditEntries: [AuditEntry] = []

    private let logger = AlfredLogger.app

    func refresh() {
        // TODO: Fetch real privacy stats from Gateway
        // Task {
        //     let stats = try await GatewayClient.shared.getPrivacyStats()
        //     localCallCount = stats.localCalls
        //     cloudCallCount = stats.cloudCalls
        //     piiBlockedCount = stats.piiBlocked
        //     totalSessions = stats.sessions
        //     privacyScore = calculateScore(stats)
        //     piiDetections = stats.recentPIIDetections
        //     auditEntries = stats.recentAuditEntries
        // }

        logger.info("Privacy dashboard refreshed")
    }
}

// MARK: - Data Models

struct PIIDetection: Identifiable {
    let id = UUID()
    let type: String        // e.g., "Email Address", "Phone Number"
    let action: String      // e.g., "Redacted before cloud call"
    let timestamp: Date

    var formattedDate: String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: timestamp, relativeTo: Date())
    }
}

struct AuditEntry: Identifiable {
    let id = UUID()
    let action: String      // e.g., "Chat message processed"
    let isLocal: Bool
    let timestamp: Date

    var formattedDate: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "MMM d, h:mm a"
        return formatter.string(from: timestamp)
    }
}

// MARK: - Preview

#if DEBUG
struct PrivacyDashboard_Previews: PreviewProvider {
    static var previews: some View {
        PrivacyDashboard()
    }
}
#endif
