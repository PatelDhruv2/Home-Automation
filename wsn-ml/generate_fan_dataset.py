import csv
import random
from pathlib import Path
ROWS = 1030
NOISE_RATE = 0.07
OUTPUT_PATH = Path(__file__).with_name("fan_behavior_dataset.csv")
def clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, value))
def base_on_probability(
    hour: int,
    day_of_week: int,
    prev_state: int,
    time_since_last_change: int,
    rng: random.Random,
) -> float:
    if 11 <= hour <= 16:
        prob = 0.71
    elif 17 <= hour <= 21:
        prob = 0.57
    elif 6 <= hour <= 9:
        prob = 0.27
    elif 0 <= hour <= 4:
        prob = 0.08
    else:
        prob = 0.37

    if day_of_week in (5, 6):
        prob += 0.08 if 10 <= hour <= 21 else -0.03
    elif 9 <= hour <= 17:
        prob += 0.04

    continuity_factor = 0.18 if prev_state == 1 else -0.11
    toggling_guard = (1 - min(time_since_last_change, 120) / 120) * 0.18
    prob += continuity_factor
    prob += toggling_guard if prev_state == 1 else -toggling_guard

    if time_since_last_change >= 180 and 12 <= hour <= 20:
        prob += 0.06
    elif time_since_last_change >= 180 and (hour <= 5 or hour >= 23):
        prob -= 0.07

    prob += rng.uniform(-0.03, 0.03)
    return clamp(prob, 0.02, 0.98)


def generate_rows(seed: int) -> list[dict[str, int]]:
    rng = random.Random(seed)
    rows: list[dict[str, int]] = []

    day_of_week = rng.randrange(0, 7)
    minutes_of_day = rng.choice([0, 30, 60, 90, 120, 300, 360, 420, 480, 540])
    prev_target = rng.choice([0, 0, 1])
    minutes_since_change = rng.randint(25, 180)

    for _ in range(ROWS):
        hour = (minutes_of_day // 60) % 24
        prev_state = prev_target
        time_since_last_change = min(minutes_since_change, 300)

        on_probability = base_on_probability(
            hour=hour,
            day_of_week=day_of_week,
            prev_state=prev_state,
            time_since_last_change=time_since_last_change,
            rng=rng,
        )

        target = 1 if rng.random() < on_probability else 0

        if rng.random() < NOISE_RATE:
            target = 1 - target

        rows.append(
            {
                "hour": hour,
                "day_of_week": day_of_week,
                "prev_state": prev_state,
                "time_since_last_change": time_since_last_change,
                "target": target,
            }
        )

        delta_minutes = rng.choice([10, 10, 15, 15, 20, 20, 30, 30, 45, 60])
        minutes_of_day += delta_minutes
        if minutes_of_day >= 24 * 60:
            day_rollover = minutes_of_day // (24 * 60)
            minutes_of_day %= 24 * 60
            day_of_week = (day_of_week + day_rollover) % 7

        if target != prev_target:
            minutes_since_change = delta_minutes
        else:
            minutes_since_change = min(minutes_since_change + delta_minutes, 300)
        prev_target = target

    return rows


def find_balanced_rows() -> list[dict[str, int]]:
    for seed in range(11, 500):
        rows = generate_rows(seed)
        on_count = sum(row["target"] for row in rows)
        ratio = on_count / ROWS
        if 0.40 <= ratio <= 0.60:
            return rows
    raise RuntimeError("Unable to generate a balanced dataset in the requested range.")


def write_csv(rows: list[dict[str, int]]) -> None:
    with OUTPUT_PATH.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "hour",
                "day_of_week",
                "prev_state",
                "time_since_last_change",
                "target",
            ],
        )
        writer.writeheader()
        writer.writerows(rows)


if __name__ == "__main__":
    dataset_rows = find_balanced_rows()
    write_csv(dataset_rows)
