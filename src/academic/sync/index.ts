/**
 * Academic sync — what the CLIENT is allowed to know about it.
 *
 * There used to be an engine.ts here wrapping three RPCs:
 * process_pending_academic_events, process_academic_event and
 * refresh_student_academic_profile. None of the three is granted to
 * `authenticated`, so every call from a browser returned 403; the only caller
 * swallowed the error, so it looked like it worked for as long as nobody
 * watched the network tab.
 *
 * Draining the queue is a cron job (`process-pending-academic-events`, every
 * minute) and belongs there: it processes the whole school's events, which is
 * not a thing one student's browser should be doing. The module is deleted
 * rather than left with a comment, because a facade over calls that cannot
 * succeed is an invitation to call them again.
 *
 * What remains is the one thing that was ever pure: which surfaces an event
 * type fans out to. That lives in ../events and is re-exported here under its
 * own name.
 */
export { syncTargetsFor, type SyncTarget } from "../events";
