

const NO_BANK_MSG = "No questions available for this combination yet";

export function isEmptyQuestionBankError(message: string) {
  return message.toLowerCase().includes("no questions available");
}

export function canUseMath12TemplateSolo(subject: string, grade: number | null) {
  return grade === 12 && subject.toLowerCase() === "mathematics";
}




export { NO_BANK_MSG };
