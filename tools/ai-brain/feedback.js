'use strict';
// TASK-AI-25 — Production wrapper for the qualifiedRoles feedback rule.
//
// The removal decision lives in exactly one place:
//   tools/ai-brain/acceptance/lib/role-feedback.js
//
// This file re-exports that module by reference so the production require
// path (tools/ai-brain/feedback) and the acceptance require path
// (tools/ai-brain/acceptance/lib/role-feedback) resolve the same rule.
// AC-AI-25-04 enforces this: a private copy here exits 1 SINGLE_SOURCE_FAILED.
//
// Never define evaluateNarrowing, applyNarrowing, or any removal rule locally.

module.exports = require('./acceptance/lib/role-feedback');
