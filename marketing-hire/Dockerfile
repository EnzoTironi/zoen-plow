FROM public.ecr.aws/e1h7x4a2/plow-cloud-agents:base-7ce757a1745de286dd180c5c5182aca31eba8a75@sha256:6e5e1a11a8c6e2ef6ecaa5e7b429e778a9a3befaf416a09922aaaa4a5b21d647

# Cloud installs have no compose file. Boot reports this listing only when AGENT_ID is set.
ENV AGENT_ID=zoen-distribution
ENV AGENT_NAME="Zoen for distribution"
ENV AGENT_BLURB="Automate your whole flow of distribution and growth. Drafts the posts and outreach, watches public mentions, and texts you before anything goes out."

# Merges into the base image skills. Do not ship copies of google-workspace or owners-mac here.
COPY prompt/AGENTS.md /opt/plow/prompt/AGENTS.md
COPY skills/ /opt/plow/skills/
