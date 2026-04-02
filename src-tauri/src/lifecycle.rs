use serde::Serialize;

/// Screensaver lifecycle states.
///
/// The state machine is intentionally simple — two states, two transitions.
/// Complexity lives in the *conditions* for transitioning, not in extra states.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum ScreensaverState {
    /// Polling idle time, waiting for the timeout threshold to be exceeded.
    Monitoring,
    /// Screensaver overlay is active and rendering.
    ScreensaverActive,
}

/// Lifecycle transition events emitted when the state machine changes state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StateTransition {
    Activate,
    Deactivate,
}

/// Runtime-configurable parameters for the lifecycle state machine.
#[derive(Debug, Clone)]
pub struct LifecycleConfig {
    /// Seconds of idle time before the screensaver activates.
    pub idle_timeout_secs: u64,
    /// Seconds between idle-time polling ticks.
    pub poll_interval_secs: u64,
}

impl Default for LifecycleConfig {
    fn default() -> Self {
        Self {
            idle_timeout_secs: 300,
            poll_interval_secs: 5,
        }
    }
}

/// Pure, deterministic state machine for the screensaver lifecycle.
///
/// All I/O (reading idle time, creating windows) happens *outside* this struct.
/// Callers feed observed idle seconds via [`tick`] and user-input events via
/// [`on_user_input`]; the machine returns an optional transition when the
/// state actually changes.
pub struct LifecycleMachine {
    state: ScreensaverState,
    config: LifecycleConfig,
}

impl LifecycleMachine {
    pub fn new(config: LifecycleConfig) -> Self {
        Self {
            state: ScreensaverState::Monitoring,
            config,
        }
    }

    pub fn state(&self) -> ScreensaverState {
        self.state
    }

    /// Will be used by the settings UI to display/edit lifecycle configuration.
    #[allow(dead_code)]
    pub fn config(&self) -> &LifecycleConfig {
        &self.config
    }

    /// Called on every poll tick with the current system idle time.
    ///
    /// Returns `Some(Activate)` exactly once when idle time first exceeds the
    /// configured timeout while in `Monitoring` state. Subsequent ticks in
    /// `ScreensaverActive` return `None` (no repeated activation).
    pub fn tick(&mut self, idle_secs: u64) -> Option<StateTransition> {
        match self.state {
            ScreensaverState::Monitoring if idle_secs >= self.config.idle_timeout_secs => {
                self.state = ScreensaverState::ScreensaverActive;
                Some(StateTransition::Activate)
            }
            _ => None,
        }
    }

    /// Immediately transitions to `ScreensaverActive` regardless of idle time.
    ///
    /// Used for manual activation from the settings/debug UI. No-op if already
    /// active. Does not return a transition event because the caller is
    /// responsible for creating windows and emitting events directly.
    pub fn force_activate(&mut self) {
        self.state = ScreensaverState::ScreensaverActive;
    }

    /// Called when user input is detected (keyboard or mouse beyond dead-zone).
    ///
    /// Returns `Some(Deactivate)` exactly once when transitioning out of
    /// `ScreensaverActive`. Calling this while already `Monitoring` is a no-op.
    pub fn on_user_input(&mut self) -> Option<StateTransition> {
        match self.state {
            ScreensaverState::ScreensaverActive => {
                self.state = ScreensaverState::Monitoring;
                Some(StateTransition::Deactivate)
            }
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn default_machine() -> LifecycleMachine {
        LifecycleMachine::new(LifecycleConfig::default())
    }

    fn quick_machine(timeout: u64) -> LifecycleMachine {
        LifecycleMachine::new(LifecycleConfig {
            idle_timeout_secs: timeout,
            ..Default::default()
        })
    }

    // -- Initial state --

    #[test]
    fn starts_in_monitoring_state() {
        let machine = default_machine();
        assert_eq!(machine.state(), ScreensaverState::Monitoring);
    }

    // -- Activation --

    #[test]
    fn activates_when_idle_reaches_timeout() {
        let mut machine = quick_machine(10);
        let transition = machine.tick(10);
        assert_eq!(transition, Some(StateTransition::Activate));
        assert_eq!(machine.state(), ScreensaverState::ScreensaverActive);
    }

    #[test]
    fn activates_when_idle_exceeds_timeout() {
        let mut machine = quick_machine(10);
        let transition = machine.tick(15);
        assert_eq!(transition, Some(StateTransition::Activate));
        assert_eq!(machine.state(), ScreensaverState::ScreensaverActive);
    }

    #[test]
    fn does_not_activate_below_timeout() {
        let mut machine = quick_machine(10);
        assert_eq!(machine.tick(0), None);
        assert_eq!(machine.tick(5), None);
        assert_eq!(machine.tick(9), None);
        assert_eq!(machine.state(), ScreensaverState::Monitoring);
    }

    #[test]
    fn does_not_re_emit_activate_on_subsequent_ticks() {
        let mut machine = quick_machine(10);
        assert_eq!(machine.tick(10), Some(StateTransition::Activate));
        // Already active — further ticks should be no-ops.
        assert_eq!(machine.tick(11), None);
        assert_eq!(machine.tick(100), None);
        assert_eq!(machine.state(), ScreensaverState::ScreensaverActive);
    }

    // -- Deactivation --

    #[test]
    fn deactivates_on_user_input_while_active() {
        let mut machine = quick_machine(10);
        machine.tick(10); // activate
        let transition = machine.on_user_input();
        assert_eq!(transition, Some(StateTransition::Deactivate));
        assert_eq!(machine.state(), ScreensaverState::Monitoring);
    }

    #[test]
    fn user_input_while_monitoring_is_noop() {
        let mut machine = default_machine();
        assert_eq!(machine.on_user_input(), None);
        assert_eq!(machine.state(), ScreensaverState::Monitoring);
    }

    #[test]
    fn does_not_re_emit_deactivate_on_repeated_input() {
        let mut machine = quick_machine(10);
        machine.tick(10); // activate
        assert_eq!(machine.on_user_input(), Some(StateTransition::Deactivate));
        assert_eq!(machine.on_user_input(), None);
        assert_eq!(machine.state(), ScreensaverState::Monitoring);
    }

    // -- Full cycle --

    #[test]
    fn full_activate_deactivate_reactivate_cycle() {
        let mut machine = quick_machine(5);

        // Idle ramps up → activate
        assert_eq!(machine.tick(3), None);
        assert_eq!(machine.tick(5), Some(StateTransition::Activate));

        // User wiggles mouse → deactivate
        assert_eq!(machine.on_user_input(), Some(StateTransition::Deactivate));
        assert_eq!(machine.state(), ScreensaverState::Monitoring);

        // Idle resets then ramps again → re-activate
        assert_eq!(machine.tick(0), None);
        assert_eq!(machine.tick(5), Some(StateTransition::Activate));
        assert_eq!(machine.state(), ScreensaverState::ScreensaverActive);
    }

    // -- Config --

    #[test]
    fn default_config_uses_five_minute_timeout() {
        let config = LifecycleConfig::default();
        assert_eq!(config.idle_timeout_secs, 300);
        assert_eq!(config.poll_interval_secs, 5);
    }

    #[test]
    fn custom_config_is_respected() {
        let mut machine = LifecycleMachine::new(LifecycleConfig {
            idle_timeout_secs: 60,
            poll_interval_secs: 2,
        });
        assert_eq!(machine.tick(59), None);
        assert_eq!(machine.tick(60), Some(StateTransition::Activate));
    }

    // -- Edge cases --

    #[test]
    fn zero_timeout_activates_immediately() {
        let mut machine = quick_machine(0);
        assert_eq!(machine.tick(0), Some(StateTransition::Activate));
    }

    #[test]
    fn large_idle_value_activates_normally() {
        let mut machine = quick_machine(300);
        assert_eq!(machine.tick(u64::MAX), Some(StateTransition::Activate));
    }

    // -- Serialization --

    #[test]
    fn state_serializes_to_expected_strings() {
        let monitoring = serde_json::to_string(&ScreensaverState::Monitoring).unwrap();
        let active = serde_json::to_string(&ScreensaverState::ScreensaverActive).unwrap();
        assert_eq!(monitoring, "\"Monitoring\"");
        assert_eq!(active, "\"ScreensaverActive\"");
    }

    // -- Force activate --

    #[test]
    fn force_activate_transitions_from_monitoring() {
        let mut machine = default_machine();
        machine.force_activate();
        assert_eq!(machine.state(), ScreensaverState::ScreensaverActive);
    }

    #[test]
    fn force_activate_is_idempotent_when_already_active() {
        let mut machine = quick_machine(10);
        machine.tick(10); // normal activation
        machine.force_activate(); // should not change state
        assert_eq!(machine.state(), ScreensaverState::ScreensaverActive);
    }

    #[test]
    fn force_activate_then_deactivate_cycle() {
        let mut machine = default_machine();
        machine.force_activate();
        assert_eq!(machine.state(), ScreensaverState::ScreensaverActive);
        assert_eq!(machine.on_user_input(), Some(StateTransition::Deactivate));
        assert_eq!(machine.state(), ScreensaverState::Monitoring);
    }
}
