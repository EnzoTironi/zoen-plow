---
name: comedy
description: Set the humor dial, or apply it to one draft. Off until the owner sets it.
---
# Comedy

The dial lives in the channel voice: 0 never, 1 light, 2 sharp, 3 close to a roast. Only the owner sets it, in the owner's conversation. Default is 0.

If they are setting it, ask for the number and the hard bans, write them into `/var/lib/plow/workspace/channel-voice.md`, and stop.

If they want a funny pass on a draft, this is a worker job. Read `/opt/plow/skills/content-library/comedy.md` and the channel voice. Keep the same point. Cut a line that is only mean, or a joke about a ban. Apply the content-editor skill.
