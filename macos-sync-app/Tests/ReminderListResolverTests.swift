import XCTest
@testable import MavinciReminders

final class ReminderListResolverTests: XCTestCase {
    let first = ReminderListChoice(id: "icloud-list", title: "Mateusz CRM", account: "iCloud")
    let other = ReminderListChoice(id: "local-list", title: "Mateusz CRM", account: "Na moim Macu")

    func testExistingEmptyListStillResolvesByID() throws {
        // No reminder count is used to decide whether a calendar exists.
        XCTAssertEqual(try ReminderListResolver.resolve([first], cachedID: first.id, name: first.title), first)
    }
    func testStaleIDRebindsToUniqueExistingList() throws {
        XCTAssertEqual(try ReminderListResolver.resolve([first], cachedID: "deleted-id", name: first.title), first)
    }
    func testDuplicateNamesUseIDNotFirstAccount() throws {
        XCTAssertEqual(try ReminderListResolver.resolve([first, other], cachedID: other.id, name: first.title), other)
    }
    func testAmbiguousNameFailsWithoutCreatingOrSelectingList() {
        XCTAssertThrowsError(try ReminderListResolver.resolve([first, other], cachedID: nil, name: first.title)) {
            guard case RemindersError.ambiguousList = $0 else { return XCTFail("Wrong error") }
        }
    }
    func testEmptySystemResponseIsNotADeletedList() {
        XCTAssertThrowsError(try ReminderListResolver.resolve([], cachedID: first.id, name: first.title)) {
            guard case RemindersError.noLists = $0 else { return XCTFail("Wrong error") }
        }
    }
    func testMissingListErrorIsNotCRMError() {
        XCTAssertThrowsError(try ReminderListResolver.resolve([other], cachedID: nil, name: "Missing")) {
            guard case RemindersError.missingList = $0 else { return XCTFail("Wrong error") }
        }
    }
    func testRenamingSelectedListKeepsIdentity() throws {
        XCTAssertEqual(try ReminderListResolver.resolve([first], cachedID: first.id, name: "Old name"), first)
    }
}
