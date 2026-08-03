/**
 * English message dictionary — the canonical source. Every other locale is
 * measured against this file's key set: a missing key in another locale
 * falls back to the English string at render time.
 *
 * Keys are dot-namespaced for organization. Values may contain `{name}`
 * placeholders — the resolver substitutes any string/number token by name.
 * Placeholders never accept raw HTML; if you need markup, split the
 * sentence at the interpolation point and compose in JSX.
 *
 * Adding a namespace: keep it small and scoped ("chat.composer.*",
 * "auth.login.*"). Adding a key: add it here first, then to every other
 * dictionary at once — the type-level MessageKey union depends on this file.
 */
export const en = {
  common: {
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete',
    edit: 'Edit',
    close: 'Close',
    loading: 'Loading…',
    retry: 'Retry',
    search: 'Search',
    somethingWentWrong: 'Something went wrong.',
  },
  auth: {
    signIn: 'Sign In',
    signOut: 'Sign Out',
    createAccount: 'Create Account',
    email: 'Email',
    password: 'Password',
    forgotPassword: 'Forgot password?',
    rememberMe: 'Remember me',
    noAccount: 'Don\'t have an account?',
    haveAccount: 'Already have an account?',
    register: 'Register',
  },
  chat: {
    newConversation: 'New Conversation',
    sendMessage: 'Send a message…',
    send: 'Send',
    thinking: 'Thinking…',
    regenerate: 'Regenerate',
    stop: 'Stop',
  },
  workspace: {
    switcher: 'Switch workspace',
    createFirst: 'Create your first workspace',
    settings: 'Workspace settings',
  },
  welcome: {
    heading: 'Let\'s get you set up in about a minute.',
    subheading: 'You can skip any step — this is a fast tour, not a form.',
    step1: 'Workspace',
    step2: 'Profile',
    step3: 'Start',
    skip: 'Skip for now',
    continue: 'Continue',
  },
  developer: {
    apiKeys: 'API keys',
    newKey: 'New API key',
    revoke: 'Revoke',
    revealOnce: 'Save your API key',
    revealHint: 'This is the only time we\'ll show the full secret. Copy it now and store it somewhere safe.',
  },
} as const;

/**
 * The recursive key union — dot-joined paths through the dictionary tree.
 * The `useT()` hook rejects any key that isn't in this union at compile
 * time, so a typo in a message id is a build error, not a runtime "".
 */
type Leaves<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string
    ? `${Prefix}${K}`
    : Leaves<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

export type MessageKey = Leaves<typeof en>;
export type Dictionary = typeof en;
