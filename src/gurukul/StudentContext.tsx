import { createContext, useContext } from "react";
import { EMPTY_STUDENT, type GurukulStudentProfile } from "@/gurukul/emptyStudent";

export type GurukulStudent = GurukulStudentProfile;

const Ctx = createContext<GurukulStudent>(EMPTY_STUDENT);
const ShellReadyCtx = createContext(false);

export function GurukulStudentProvider({
  value,
  shellReady = true,
  children,
}: {
  value: GurukulStudent;
  shellReady?: boolean;
  children: React.ReactNode;
}) {
  return (
    <ShellReadyCtx.Provider value={shellReady}>
      <Ctx.Provider value={value}>{children}</Ctx.Provider>
    </ShellReadyCtx.Provider>
  );
}

export function useGurukulStudent() {
  return useContext(Ctx);
}

export function useGurukulShellReady() {
  return useContext(ShellReadyCtx);
}
