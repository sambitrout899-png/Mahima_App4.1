// Backward-compatible entry point for older route/setup files.
// Keep this module as a pure re-export so only one Teams implementation can
// ever enter the production bundle.
export { default } from "./TeamsPage";
