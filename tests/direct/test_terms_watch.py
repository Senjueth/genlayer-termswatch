"""TermsWatch: baseline only on a page that states every commitment; rechecks judged only when the text changed."""

import hashlib
import json

import pytest

from tests.direct.conftest import PAGE, PROMISES, URL, reading, to_hex

TEXT = "Privacy We promise we never sell your data. You can delete your account at any time; all data is deleted."
SHA = hashlib.sha256(TEXT.encode()).hexdigest()
NEW = PAGE.replace("never sell", "do not sell")


@pytest.mark.parametrize(
    "args,err",
    [
        (("P", URL, json.dumps(PROMISES)), "name must be"),
        (("Plausible", "http://plausible.io/privacy", json.dumps(PROMISES)), "https URL"),
        (("Plausible", URL, "not json"), "JSON list"),
        (("Plausible", URL, json.dumps({"a": 1})), "JSON list"),
        (("Plausible", URL, "[]"), "1-8 commitments"),
        (("Plausible", URL, json.dumps(["x" * 20] * 9)), "1-8 commitments"),
        (("Plausible", URL, json.dumps(["short"])), "10-200"),
        (("Plausible", URL, json.dumps(["We never sell data", "we NEVER sell  data"])), "distinct"),
    ],
)
def test_watch_input_is_validated(args, err, direct_vm, direct_deploy):
    c = direct_deploy("contracts/terms_watch.py")
    reading(direct_vm)
    with direct_vm.expect_revert(err):
        c.watch(*args)
    assert c.get_count() == 0


def test_watch_pins_the_text_hash(tw, direct_alice):
    w = tw.get_watch(0)
    assert w["status"] == "HELD" and w["checks"] == 1 and w["text_sha256"] == SHA
    assert w["commitments"] == PROMISES and w["states"] == ["kept", "kept"]
    assert w["creator"].lower() == to_hex(direct_alice).lower()
    h = tw.get_history(0, 0)
    assert [x["outcome"] for x in h] == ["BASELINE"] and h[0]["text_chars"] == len(TEXT)


def test_a_page_that_does_not_state_a_commitment_is_no_baseline(direct_vm, direct_deploy):
    c = direct_deploy("contracts/terms_watch.py")
    reading(direct_vm, ("kept", "dropped"))
    with direct_vm.expect_revert("commitment(s) [2]"):
        c.watch("Plausible", URL, json.dumps(PROMISES))
    assert c.get_count() == 0


def test_same_text_is_unchanged_without_asking_the_model(tw, direct_vm, direct_bob):
    # The model would now say "dropped"; it must not be asked for an unchanged text.
    reading(direct_vm, ("dropped", "dropped"), page=PAGE.replace("<p>", "<div>"))
    direct_vm.sender = direct_bob
    assert tw.recheck(0) == {"outcome": "UNCHANGED", "status": "HELD", "states": ["kept", "kept"]}
    w = tw.get_watch(0)
    assert w["checks"] == 2 and w["text_sha256"] == SHA
    assert tw.get_history(0, 0)[1]["by"].lower() == to_hex(direct_bob).lower()


def test_changed_text_is_judged_per_commitment_and_recorded(tw, direct_vm):
    reading(direct_vm, ("kept", "weakened"), page=NEW)
    assert tw.recheck(0) == {"outcome": "CHANGED", "status": "BROKEN", "states": ["kept", "weakened"]}
    w = tw.get_watch(0)
    assert w["status"] == "BROKEN" and w["text_sha256"] != SHA
    # Restored wording holds again; history keeps all three.
    reading(direct_vm, ("kept", "kept"))
    assert tw.recheck(0)["status"] == "HELD"
    assert [x["outcome"] for x in tw.get_history(0, 0)] == ["BASELINE", "CHANGED", "CHANGED"]
    assert tw.get_history(0, 0)[1]["states"] == ["kept", "weakened"]


def test_unavailable_or_oversized_page_reverts_and_records_nothing(tw, direct_vm):
    reading(direct_vm, status=503)
    with direct_vm.expect_revert("HTTP 503"):
        tw.recheck(0)
    reading(direct_vm, page=PAGE + " word" * 5000)
    with direct_vm.expect_revert("over 20000 characters"):
        tw.recheck(0)
    assert tw.get_watch(0)["checks"] == 1
    with direct_vm.expect_revert("watch not found"):
        tw.recheck(1)


def test_bad_model_output_reverts(tw, direct_vm):
    reading(direct_vm, ("kept",), page=NEW)
    with direct_vm.expect_revert("LLM_ERROR"):
        tw.recheck(0)
    reading(direct_vm, ("kept", "maybe"), page=NEW)
    with direct_vm.expect_revert("LLM_ERROR"):
        tw.recheck(0)


def test_scripts_comments_and_markup_do_not_change_the_hash(tw, direct_vm):
    reading(direct_vm, ("dropped", "dropped"), page="<!-- v2 --><script>track()</script>" + PAGE.replace("<p>", '<p class="x">'))
    assert tw.recheck(0)["outcome"] == "UNCHANGED"


# ── Consensus ───────────────────────────────────────────────────────────────


def test_validator_agrees_only_on_identical_hash_and_states(tw, direct_vm):
    reading(direct_vm, ("kept", "weakened"), page=NEW)
    tw.recheck(0)
    mine = direct_vm._captured_validators[-1][0]
    assert direct_vm.run_validator(leader_result=mine) is True
    assert direct_vm.run_validator(leader_result={**mine, "states": ["kept", "dropped"]}) is False
    assert direct_vm.run_validator(leader_result={**mine, "sha256": SHA}) is False
    assert direct_vm.run_validator(leader_result={**mine, "states": None}) is False


def test_validators_agree_on_the_same_page_error_only(tw, direct_vm):
    reading(direct_vm, page=NEW)
    tw.recheck(0)
    reading(direct_vm, status=404)
    assert direct_vm.run_validator(leader_error="[EXTERNAL] policy page unavailable (HTTP 404)") is True
    assert direct_vm.run_validator(leader_error="[EXTERNAL] policy page unavailable (HTTP 500)") is False
    reading(direct_vm, page=NEW)
    assert direct_vm.run_validator(leader_error="[EXTERNAL] policy page unavailable (HTTP 404)") is False
