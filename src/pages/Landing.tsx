/**
 * Guest marketing homepage.
 * Renders the Gurukul landing design from /landing.html while keeping
 * Index.tsx auth redirects on `/` for signed-in users.
 */
export default function Landing({ noRoleBanner = false }: { noRoleBanner?: boolean } = {}) {
  return (
    <div className="fixed inset-0 z-0 bg-[#FAFBFC]">
      {noRoleBanner && (
        <div className="absolute top-0 inset-x-0 z-20 bg-amber-50 border-b border-amber-200 text-amber-950">
          <p className="mx-auto max-w-3xl px-4 py-2.5 text-center text-sm">
            You&apos;re signed in but don&apos;t have a role yet. Your admin will assign access to unlock your dashboard.
          </p>
        </div>
      )}
      <iframe
        title="Gurukul — AI-Powered Learning Engine"
        src="/landing.html"
        className="absolute inset-0 h-full w-full border-0"
        style={noRoleBanner ? { top: 44 } : undefined}
      />
    </div>
  );
}
