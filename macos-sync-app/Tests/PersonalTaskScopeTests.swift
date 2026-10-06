import XCTest
@testable import MavinciReminders

final class PersonalTaskScopeTests: XCTestCase {
    private let employee = "11111111-1111-4111-8111-111111111111"

    private func task(_ changes: [String: Any] = [:]) -> [String: Any] {
        var value: [String: Any] = [
            "id": "22222222-2222-4222-8222-222222222222", "assigned_employee_id": employee,
            "title": "Przykładowe zadanie", "priority": "medium", "status": "todo",
            "board_column": "todo", "is_private": false,
            "created_at": "2026-09-11T10:00:00Z", "updated_at": "2026-09-11T10:00:00Z"
        ]
        value.merge(changes) { _, new in new }
        return value
    }

    private func response(tasks: [[String: Any]], changes: [String: Any] = [:]) throws -> CRMTasksResponse {
        var value: [String: Any] = ["success": true, "task_scope": "tasks_board_assigned_v1",
                                   "employee_id": employee, "tasks": tasks]
        value.merge(changes) { _, new in new }
        return try JSONDecoder().decode(CRMTasksResponse.self, from: JSONSerialization.data(withJSONObject: value))
    }

    func testAcceptsOwnTask() throws {
        let data = try response(tasks: [task()])
        XCTAssertNoThrow(try data.validatePersonalScope())
    }

    func testAcceptsConfirmedEmptyList() throws {
        let data = try response(tasks: [])
        XCTAssertNoThrow(try data.validatePersonalScope())
    }

    func testRejectsOldBackendEvenForEmptyList() throws {
        let data = try response(tasks: [], changes: ["task_scope": NSNull()])
        XCTAssertThrowsError(try data.validatePersonalScope()) { error in
            guard case CRMAPIError.unsupportedTaskScope = error else { return XCTFail("Wrong error: \(error)") }
        }
    }

    func testRejectsAnotherEmployeesTask() throws {
        let data = try response(tasks: [task(["assigned_employee_id": "33333333-3333-4333-8333-333333333333"])])
        XCTAssertThrowsError(try data.validatePersonalScope())
    }

    func testRejectsMissingAssignment() throws {
        let data = try response(tasks: [task(["assigned_employee_id": NSNull()])])
        XCTAssertThrowsError(try data.validatePersonalScope())
    }

    func testRejectsEventTask() throws {
        let data = try response(tasks: [task(["event_id": "44444444-4444-4444-8444-444444444444"])])
        XCTAssertThrowsError(try data.validatePersonalScope())
    }

    func testRejectsPrivateTaskOutsideBoard() throws {
        let data = try response(tasks: [task(["is_private": true])])
        XCTAssertThrowsError(try data.validatePersonalScope())
    }

    func testRejectsFailureAndMissingEmployee() throws {
        for changes: [String: Any] in [["success": false], ["employee_id": NSNull()]] {
            let data = try response(tasks: [], changes: changes)
            XCTAssertThrowsError(try data.validatePersonalScope())
        }
    }

    func testClosedTasksAreNotCountedAsActive() throws {
        let data = try response(tasks: [task(), task(["status": "completed"]), task(["status": "cancelled"])])
        XCTAssertEqual(data.tasks?.filter { !$0.isCompleted }.count, 1)
        XCTAssertEqual(data.tasks?.filter { $0.isCompleted }.count, 2)
    }
}
