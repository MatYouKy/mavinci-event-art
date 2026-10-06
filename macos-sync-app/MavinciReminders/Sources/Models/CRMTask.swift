import Foundation

// MARK: - Task Fetch Response

struct CRMTasksResponse: Codable {
    let success: Bool
    let task_scope: String?
    let employee_id: String?
    let employee_name: String?
    let tasks: [CRMTask]?
    let synced_at: String?
    let error: String?

    /// Pure validation: do not touch EventKit, credentials or local state before this succeeds.
    func validatePersonalScope() throws {
        guard success, task_scope == "tasks_board_assigned_v1",
              let employee = employee_id, UUID(uuidString: employee) != nil,
              let tasks,
              tasks.allSatisfy({ $0.assigned_employee_id == employee && $0.event_id == nil && !$0.is_private }) else {
            throw CRMAPIError.unsupportedTaskScope
        }
    }
}

// MARK: - CRM Task

struct CRMTask: Codable, Identifiable {
    let id: String
    let assigned_employee_id: String?
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
    var expected_updated_at: String? = nil
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
