

const NO_BANK_MSG = "No questions available for this combination yet";

export function isEmptyQuestionBankError(message: string) {
  return message.toLowerCase().includes("no questions available");
}





export { NO_BANK_MSG };
