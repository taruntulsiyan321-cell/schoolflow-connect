import { createContext, useContext } from "react";
import { EMPTY_STUDENT, type GurukulStudentProfile } from "@/gurukul/emptyStudent";

export type GurukulStudent = GurukulStudentProfile;

const Ctx = createContext<GurukulStudent>(EMPTY_STUDENT);

export function GurukulStudentProvider({
  value,
  children,
}: {
  value: GurukulStudent;
  children: React.ReactNode;
}) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useGurukulStudent() {
  return useContext(Ctx);
}
