"""python -m app.contract_export  -> writes one JSON Schema per message type into ../contract/ (deterministic)."""
import json
from pathlib import Path
from .models import MODELS, HAVE_PYDANTIC


def main(out=Path(__file__).resolve().parent.parent / "contract"):
    if not HAVE_PYDANTIC:
        raise SystemExit("pydantic is required: pip install -r requirements.txt")
    out.mkdir(parents=True, exist_ok=True)
    for name, model in MODELS.items():
        (out / f"{name}.schema.json").write_text(json.dumps(model.model_json_schema(), indent=2, sort_keys=True) + "\n")
        print("wrote", out / f"{name}.schema.json")


if __name__ == "__main__":
    main()
