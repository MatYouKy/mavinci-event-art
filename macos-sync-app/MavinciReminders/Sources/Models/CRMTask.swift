import Foundation

// MARK: - Task Fetch Response

struct CRMTasksResponse: Codable {
    let success: Bool
    let employee_id: String?
    let employee_name: String?
    let tasks: [CRMTask]?
    let synced_at: String?
    let error: String?
}

// MARK: - CRM Task

struct CRMTask: Codable, Identifiable {
    let id: String
    let title: String
    let description: String?
    let priority: String  // low, medium, high, urgent
    let status: String    // todo, in_progress, review, completed, cancelled
    let board_column: String // todo, in_progress, review, completed
    let due_date: String?
    let event_id: String?
    let event_name: String?
    let is_private: Bool
    let created_at: String
    let updated_at: String

    var isCompleted: Bool {
        board_column == "completed" || status == "completed" || status == "cancelled"
    }
}

// MARK: - Completion Sync

struct CompletionUpdate: Codable {
    let task_id: String
    let completed: Bool
}

struct CompletionRequest: Codable {
    let updates: [CompletionUpdate]
}

struct CompletionResponse: Codable {
    let success: Bool
    let results: [CompletionResult]?
    let error: String?
}

struct CompletionResult: Codable {
    let task_id: String
    let success: Bool
    let error: String?
}
