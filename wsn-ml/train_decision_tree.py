from pathlib import Path

import pandas as pd
from sklearn.metrics import accuracy_score, classification_report
from sklearn.model_selection import train_test_split
from sklearn.tree import DecisionTreeClassifier, _tree, export_text


DATASET_PATH = Path(__file__).with_name("fan_behavior_dataset.csv")
RESULTS_PATH = Path(__file__).with_name("decision_tree_results.txt")
TARGET_COLUMN = "target"
FEATURE_COLUMNS = ["hour", "day_of_week", "prev_state", "time_since_last_change"]
INTEGER_FEATURES = set(FEATURE_COLUMNS)


def format_threshold(feature_name: str, threshold: float) -> str:
    if feature_name in INTEGER_FEATURES:
        return f"{threshold:.1f}"
    return f"{threshold:.2f}"


def tree_to_if_else(model: DecisionTreeClassifier, feature_names: list[str]) -> str:
    tree = model.tree_

    def build_node(node_id: int) -> dict[str, object]:
        if tree.feature[node_id] != _tree.TREE_UNDEFINED:
            feature_name = feature_names[tree.feature[node_id]]
            threshold = format_threshold(feature_name, tree.threshold[node_id])
            left_child = tree.children_left[node_id]
            right_child = tree.children_right[node_id]
            left_node = build_node(left_child)
            right_node = build_node(right_child)

            if left_node["type"] == "leaf" and right_node["type"] == "leaf":
                if left_node["class_id"] == right_node["class_id"]:
                    return left_node

            return {
                "type": "branch",
                "feature_name": feature_name,
                "threshold": threshold,
                "left": left_node,
                "right": right_node,
            }

        class_id = int(model.classes_[tree.value[node_id][0].argmax()])
        samples = int(tree.n_node_samples[node_id])
        return {"type": "leaf", "class_id": class_id, "samples": samples}

    def render_node(node: dict[str, object], depth: int) -> list[str]:
        indent = "    " * depth
        if node["type"] == "leaf":
            return [
                f"{indent}fanState = {node['class_id']};  // predicted from {node['samples']} training samples"
            ]

        lines = [f"{indent}if ({node['feature_name']} <= {node['threshold']}) {{"]
        lines.extend(render_node(node["left"], depth + 1))
        lines.append(f"{indent}}} else {{")
        lines.extend(render_node(node["right"], depth + 1))
        lines.append(f"{indent}}}")
        return lines

    root = build_node(0)
    return "\n".join(render_node(root, 0))


def build_report() -> str:
    df = pd.read_csv(DATASET_PATH)
    missing_columns = [column for column in [*FEATURE_COLUMNS, TARGET_COLUMN] if column not in df.columns]
    if missing_columns:
        missing_str = ", ".join(missing_columns)
        raise ValueError(f"Dataset is missing required columns: {missing_str}")

    X = df[FEATURE_COLUMNS]
    y = df[TARGET_COLUMN]

    X_train, X_test, y_train, y_test = train_test_split(
        X,
        y,
        test_size=0.2,
        random_state=42,
    )

    model = DecisionTreeClassifier(max_depth=4, random_state=42)
    model.fit(X_train, y_train)

    predictions = model.predict(X_test)
    accuracy = accuracy_score(y_test, predictions)
    report = classification_report(y_test, predictions, digits=4)
    readable_rules = export_text(model, feature_names=list(X.columns), decimals=2)
    if_else_rules = tree_to_if_else(model, list(X.columns))

    return "\n".join(
        [
            f"Accuracy score: {accuracy:.4f}",
            "",
            "Classification report:",
            report,
            "Decision tree rules:",
            readable_rules,
            "Final if-else logic:",
            if_else_rules,
        ]
    )


def main() -> None:
    output = build_report()
    print(output)
    RESULTS_PATH.write_text(output, encoding="utf-8")


if __name__ == "__main__":
    main()
