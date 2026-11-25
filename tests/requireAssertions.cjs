// Returning early or never reaching a check must not count as a passing test.
beforeEach(() => {
  expect.hasAssertions();
});
