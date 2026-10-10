/**
 * For the practice-loader stubs that play PostgREST: does this select read the
 * question TEXT (the second fetch, for the drawn ids) rather than the pool?
 *
 * The column itself, `question`, not any column that begins with the word.
 * The stubs used `select.includes("question")`, and once the pool read gained
 * `question_format` (20261155000000, C7) every pool read looked like a text
 * fetch and two suites failed on every test.
 */
export function selectsQuestionText(select: string): boolean {
  return /(^|,)\s*question\s*(,|$)/.test(select);
}
