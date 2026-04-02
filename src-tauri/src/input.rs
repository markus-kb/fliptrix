//! Mouse dead-zone logic for screensaver exit detection.
//!
//! Small involuntary mouse movements (desk vibration, sensor noise) should
//! not dismiss the screensaver. The dead-zone defines a pixel radius around
//! the cursor's initial position — movement within this radius is ignored.
//!
//! This module contains pure, deterministic math that is fully unit-tested.
//! The actual cursor tracking happens in the frontend (JS `mousemove` events)
//! which calls back to Rust when movement exceeds the threshold.

/// Default dead-zone radius in logical pixels.
/// Chosen to absorb typical desk vibration without feeling sluggish.
pub const DEFAULT_DEAD_ZONE_PX: f64 = 5.0;

/// Checks whether the cursor has moved far enough from its origin to count
/// as intentional user input.
///
/// Uses Euclidean distance so diagonal movements are treated fairly.
/// All coordinates are in logical pixels (pre-scale-factor).
pub fn exceeds_dead_zone(
    origin_x: f64,
    origin_y: f64,
    current_x: f64,
    current_y: f64,
    dead_zone_px: f64,
) -> bool {
    let dx = current_x - origin_x;
    let dy = current_y - origin_y;
    // Compare squared distances to avoid the sqrt — cheaper and equally correct.
    (dx * dx + dy * dy) > (dead_zone_px * dead_zone_px)
}

#[cfg(test)]
mod tests {
    use super::*;

    // -- Dead-zone boundary --

    #[test]
    fn no_movement_does_not_exceed() {
        assert!(!exceeds_dead_zone(100.0, 200.0, 100.0, 200.0, 5.0));
    }

    #[test]
    fn movement_within_dead_zone_does_not_exceed() {
        // 3 pixels right, 3 pixels down → distance = √18 ≈ 4.24, below 5px
        assert!(!exceeds_dead_zone(100.0, 200.0, 103.0, 203.0, 5.0));
    }

    #[test]
    fn movement_exactly_at_boundary_does_not_exceed() {
        // Exactly 5 pixels right → distance = 5.0, not strictly greater
        assert!(!exceeds_dead_zone(100.0, 200.0, 105.0, 200.0, 5.0));
    }

    #[test]
    fn movement_beyond_dead_zone_exceeds() {
        // 6 pixels right → distance = 6.0, exceeds 5px
        assert!(exceeds_dead_zone(100.0, 200.0, 106.0, 200.0, 5.0));
    }

    #[test]
    fn diagonal_movement_beyond_dead_zone_exceeds() {
        // 4 right, 4 down → distance = √32 ≈ 5.66, exceeds 5px
        assert!(exceeds_dead_zone(0.0, 0.0, 4.0, 4.0, 5.0));
    }

    #[test]
    fn negative_direction_movement_exceeds() {
        // 6 pixels left → distance = 6.0
        assert!(exceeds_dead_zone(100.0, 200.0, 94.0, 200.0, 5.0));
    }

    // -- Edge cases --

    #[test]
    fn zero_dead_zone_any_movement_exceeds() {
        // Even sub-pixel movement should exceed a zero dead-zone
        assert!(exceeds_dead_zone(0.0, 0.0, 0.001, 0.0, 0.0));
    }

    #[test]
    fn zero_dead_zone_no_movement_does_not_exceed() {
        assert!(!exceeds_dead_zone(50.0, 50.0, 50.0, 50.0, 0.0));
    }

    #[test]
    fn large_dead_zone_contains_moderate_movement() {
        // 50px dead zone, movement of 30 pixels
        assert!(!exceeds_dead_zone(0.0, 0.0, 20.0, 20.0, 50.0));
    }

    #[test]
    fn large_movement_exceeds_large_dead_zone() {
        assert!(exceeds_dead_zone(0.0, 0.0, 100.0, 100.0, 50.0));
    }

    // -- Default constant --

    #[test]
    fn default_dead_zone_is_reasonable() {
        assert!(DEFAULT_DEAD_ZONE_PX > 0.0);
        assert!(DEFAULT_DEAD_ZONE_PX <= 20.0);
    }
}
