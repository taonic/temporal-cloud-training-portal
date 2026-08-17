---
slug: workshop
id: vxmqgpgxkbmp
type: challenge
title: Your workshop sandbox
teaser: Everything the prerequisites ask you to install is already here. Your instructions
  live in the training portal.
notes:
- type: text
  contents: |-
    ## This sandbox replaces your laptop, not your browser

    Every tool the workshop needs — the Temporal CLI and its `cloud` extension,
    Terraform, Python 3.12 with `uv`, .NET 8, Docker — is already installed here,
    already at the right version, with `terraform init` and the worker build
    already run.

    **Your instructions are not in this panel.** They live in the training portal,
    in a separate tab of your own browser, because the portal knows who you are:
    it names your namespace, personalises every command, and grades your work
    against the real Temporal Cloud account while you go.

    Open the portal link your instructor sent you, put it side by side with this
    window, and keep both open all day.
tabs:
- id: fu2tgxze86jy
  title: Terminal
  type: terminal
  hostname: temporal-cloud-workshop
- id: hxyuslvjzzrk
  title: Editor
  type: service
  hostname: temporal-cloud-workshop
  port: 8443
- id: tfuai0ugt2k0
  title: Grafana
  type: service
  hostname: temporal-cloud-workshop
  port: 3030
- id: b5yesacrpzpr
  title: Prometheus
  type: service
  hostname: temporal-cloud-workshop
  port: 9090
difficulty: intermediate
timelimit: 32400
enhanced_loading: null
---

Your instructions are in the **training portal**, in a separate browser tab — not
in this panel. The portal personalises every command to you and grades each
session against the real account. Open the link your instructor sent you and keep
it beside this window all day.

This sandbox is where you *run* things.

### Start here

1. In the portal, open **Session 1** and create your Temporal Cloud API key.
2. In the Terminal tab, run `workshop-creds` and paste your address, namespace and
   key when prompted.
3. Run `workshop-check`. Everything should be green before you write any Terraform.

### Where things are

| | |
|---|---|
| Labs | `/workspace/workshop/labs` — `terraform init` is already done |
| Editor | the **Editor** tab (code-server), opened on the lab directory |
| Grafana / Prometheus | the tabs above — dark until you run `obs-up` in Session 3 |

`workshop-help` reprints the command list. `labs` and `worker` cd into the lab
directories; `rw` and `rs` run the worker and start a workflow, and they take the
same flags the session pages show.

### One warning

This sandbox is the whole workshop, and **nothing you write here survives it
being closed**. Don't close the tab and don't stop the sandbox — not over lunch,
not between sessions. If something does go wrong, tell your instructor rather
than starting again; there is a recovery path and it is much faster than
re-typing your labs.
