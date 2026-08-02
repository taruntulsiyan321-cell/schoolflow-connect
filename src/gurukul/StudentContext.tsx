import { createContext, useContext } from "react";
import { EMPTY_STUDENT, type GurukulStudentProfile } from "@/gurukul/emptyStudent";

export type GurukulStudent = GurukulStudentProfile;

/** Academic identity shared by Home + Practice (from useAcademicContext SSOT). */
export type GurukulAcademicIdentity = {
  studentId: string | null;
  schoolId: string | null;
  classId: string | null;
  classLabel: string | null;
};

const EMPTY_IDENTITY: GurukulAcademicIdentity = {
  studentId: null,
  schoolId: null,
  classId: null,
  classLabel: null,
};

const Ctx = createContext<GurukulStudent>(EMPTY_STUDENT);
const IdentityCtx = createContext<GurukulAcademicIdentity>(EMPTY_IDENTITY);
const ShellReadyCtx = createContext(false);

export function GurukulStudentProvider({
  value,
  identity = EMPTY_IDENTITY,
  shellReady = true,
  children,
}: {
  value: GurukulStudent;
  identity?: GurukulAcademicIdentity;
  shellReady?: boolean;
  children: React.ReactNode;
}) {
  return (
    <ShellReadyCtx.Provider value={shellReady}>
      <IdentityCtx.Provider value={identity}>
        <Ctx.Provider value={value}>{children}</Ctx.Provider>
      </IdentityCtx.Provider>
    </ShellReadyCtx.Provider>
  );
}

export function useGurukulStudent() {
  return useContext(Ctx);
}

/** Shared class / student row ids — same source Practice uses via AcademicContext. */
export function useGurukulAcademicIdentity() {
  return useContext(IdentityCtx);
}

export function useGurukulShellReady() {
  return useContext(ShellReadyCtx);
}
