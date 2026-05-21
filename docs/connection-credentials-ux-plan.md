# Connection Credentials UX Plan

## Goal

Make saved database connections behave like a professional desktop client:
- keep the database address visible
- keep credentials editable
- store passwords securely outside plain app state
- reconnect cleanly after app restart without forcing re-entry

## Problems Found

1. Saved connections were reloading a sanitized connection string into the form.
2. Standard SQL/NoSQL drivers had no first-class username/password section.
3. Users could not tell whether the password was missing or simply stored securely.
4. The app already used OS keychain storage, but the dialog did not expose that capability clearly.

## Implementation Phases

### Phase 1: Shared URL/Auth Helpers
- Parse username/password from URL-based connection strings.
- Rebuild URL-based connection strings from explicit auth fields.
- Strip password from visible URLs while preserving host/database details.

### Phase 2: Dialog UX
- Add an `Authentication` section for non-PI, non-SQLite drivers.
- Show username explicitly.
- Show password in a dedicated secure field with reveal toggle.
- Keep the visible connection string focused on address and database, not plaintext password.

### Phase 3: Connect/Test/Restore Contract
- Inject the explicit auth fields back into the effective connection string only when connecting/testing/saving.
- Continue storing the real password in the OS credential vault.
- Hydrate saved passwords into the dialog when a saved connection is selected.

### Phase 4: Regression Coverage
- Add tests for URL auth parsing, password stripping, and reinjection.
- Keep the existing saved-connection hydration test for keychain-backed password restore.

## Success Criteria

- Selecting a saved connection shows the real server/database address.
- The username is visible and editable.
- The password is visible only in the dedicated secure field.
- `Test` and `Connect` work after restart without retyping credentials.
- Passwords never persist in plaintext config storage.
