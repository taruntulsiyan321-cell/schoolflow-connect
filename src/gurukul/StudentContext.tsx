import { createContext, useContext } from "react";
import { student as mockStudent } from "@/gurukul/data/mock";

export type GurukulStudent = typeof mockStudent;

const Ctx = createContext<GurukulStudent>(mockStudent);

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
