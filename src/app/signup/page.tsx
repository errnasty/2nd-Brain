import { SignupForm } from "./signup-form";

// Server component so the invite requirement (a server-only env var) can be
// passed down without leaking the code itself. When SIGNUP_INVITE_CODE is
// set, account creation goes through the server action in ./actions.ts;
// otherwise the classic anon-key signUp flow is used unchanged.
export default function SignupPage() {
  return <SignupForm requiresInvite={Boolean(process.env.SIGNUP_INVITE_CODE)} />;
}
