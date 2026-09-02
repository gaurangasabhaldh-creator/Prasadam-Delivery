/* ══ FIREBASE STUB — tests only ══════════════════════════════════════
   Once js/firebase-config.js holds real keys, config.js takes the
   IS_CONFIGURED branch and calls firebase.initializeApp() at load time.
   The test pages deliberately do NOT load the Firebase SDK: a test suite
   must never authenticate against, read from, or write to the live
   project. This stub satisfies the calls config.js and ui-core.js make at
   startup and nothing more.

   Firestore access itself is not stubbed here — tests/smoke.html replaces
   the DB object's methods wholesale. Any call that slips through to
   collection() throws loudly rather than silently doing nothing, so a test
   can never quietly depend on real data.
═══════════════════════════════════════════════════════════════════════ */

window.firebase = {
  initializeApp() { return {}; },

  firestore: Object.assign(
    function () {
      return {
        enablePersistence: () => Promise.resolve(),
        collection() {
          throw new Error('[test stub] Firestore was called for real — mock the DB method you are exercising');
        },
        batch() {
          throw new Error('[test stub] Firestore batch was called for real');
        }
      };
    },
    {
      FieldValue: {
        // Tests assert on shapes, not server values; a sentinel string is
        // enough and makes an accidental real write obvious.
        serverTimestamp: () => '__serverTimestamp__',
        increment: (n) => ({ __increment: n })
      }
    }
  ),

  auth() {
    return {
      // Never fires — each suite drives AppState directly so it can test
      // any role without a real sign-in.
      onAuthStateChanged() { return () => {}; },
      signInWithEmailAndPassword() { return Promise.reject(new Error('[test stub] no auth in tests')); },
      createUserWithEmailAndPassword() { return Promise.reject(new Error('[test stub] no auth in tests')); },
      signOut() { return Promise.resolve(); }
    };
  }
};
