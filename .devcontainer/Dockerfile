#-------------------------------------------------------------------------------------------------------------
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License. See https://go.microsoft.com/fwlink/?linkid=2090316 for license information.
#-------------------------------------------------------------------------------------------------------------

FROM mcr.microsoft.com/vscode/devcontainers/typescript-node:0-12

ARG TARGET_DISPLAY=":1"

# VNC options
ARG MAX_VNC_RESOLUTION=1920x1080x16
ARG TARGET_VNC_RESOLUTION=1920x1080
ARG TARGET_VNC_DPI=72
ARG TARGET_VNC_PORT=5901
ARG VNC_PASSWORD="vscode"

# noVNC (VNC web client) options
ARG INSTALL_NOVNC="true"
ARG NOVNC_VERSION=1.1.0
ARG TARGET_NOVNC_PORT=6080
ARG WEBSOCKETIFY_VERSION=0.9.0

# Firefox is useful for testing things like browser launch events, but optional
ARG INSTALL_FIREFOX="false"

# Expected non-root username from base image
ARG USERNAME=node

# Core environment variables for X11, VNC, and fluxbox
ENV DBUS_SESSION_BUS_ADDRESS="autolaunch:" \
	MAX_VNC_RESOLUTION="${MAX_VNC_RESOLUTION}" \
	VNC_RESOLUTION="${TARGET_VNC_RESOLUTION}" \
	VNC_DPI="${TARGET_VNC_DPI}" \
	VNC_PORT="${TARGET_VNC_PORT}" \
	NOVNC_PORT="${TARGET_NOVNC_PORT}" \
	DISPLAY="${TARGET_DISPLAY}" \
	LANG="en_US.UTF-8" \
	LANGUAGE="en_US.UTF-8" \
	VISUAL="nano" \
	EDITOR="nano"

# Configure apt and install packages
RUN apt-get update \
	&& export DEBIAN_FRONTEND=noninteractive \
	#
	# Install the Cascadia Code fonts - https://github.com/microsoft/cascadia-code
	&& curl -sSL https://github.com/microsoft/cascadia-code/releases/download/v2004.30/CascadiaCode_2004.30.zip -o /tmp/cascadia-fonts.zip \
	&& unzip /tmp/cascadia-fonts.zip -d /tmp/cascadia-fonts \
	&& mkdir -p /usr/share/fonts/truetype/cascadia \
	&& mv /tmp/cascadia-fonts/ttf/* /usr/share/fonts/truetype/cascadia/ \
	&& rm -rf /tmp/cascadia-fonts.zip /tmp/cascadia-fonts \
	#
	# Install X11, fluxbox and VS Code dependencies
	&& apt-get -y install --no-install-recommends \
		xvfb \
		x11vnc \
		fluxbox \
		dbus-x11 \
		x11-utils \
		x11-xserver-utils \
		xdg-utils \
		fbautostart \
		xterm \
		eterm \
		gnome-terminal \
		gnome-keyring \
		seahorse \
		nautilus \
		libx11-dev \
		libxkbfile-dev \
		libsecret-1-dev \
		libnotify4 \
		libnss3 \
		libxss1 \
		libasound2 \
		xfonts-base \
		xfonts-terminus \
		fonts-noto \
		fonts-wqy-microhei \
		fonts-droid-fallback \
		vim-tiny \
		nano \
	#
	# [Optional] Install noVNC
	&& if [ "${INSTALL_NOVNC}" = "true" ]; then \
		mkdir -p /usr/local/novnc \
		&& curl -sSL https://github.com/novnc/noVNC/archive/v${NOVNC_VERSION}.zip -o /tmp/novnc-install.zip \
		&& unzip /tmp/novnc-install.zip -d /usr/local/novnc \
		&& cp /usr/local/novnc/noVNC-${NOVNC_VERSION}/vnc_lite.html /usr/local/novnc/noVNC-${NOVNC_VERSION}/index.html \
		&& rm /tmp/novnc-install.zip \
		&& curl -sSL https://github.com/novnc/websockify/archive/v${WEBSOCKETIFY_VERSION}.zip -o /tmp/websockify-install.zip \
		&& unzip /tmp/websockify-install.zip -d /usr/local/novnc \
		&& apt-get -y install --no-install-recommends python-numpy \
		&& ln -s /usr/local/novnc/websockify-${WEBSOCKETIFY_VERSION} /usr/local/novnc/noVNC-${NOVNC_VERSION}/utils/websockify \
		&& rm /tmp/websockify-install.zip; \
	fi \
	#
	# [Optional] Install Firefox
	&& if [ "${INSTALL_FIREFOX}" = "true" ]; then \
		apt-get -y install --no-install-recommends firefox-esr; \
	fi \
	#
	# Clean up
	&& apt-get autoremove -y \
	&& apt-get clean -y \
	&& rm -rf /var/lib/apt/lists/*

COPY bin/init-dev-container.sh /usr/local/share/
COPY bin/set-resolution /usr/local/bin/
COPY fluxbox/* /root/.fluxbox/
COPY fluxbox/* /home/${USERNAME}/.fluxbox/

# Update privs, owners of config files
RUN mkdir -p /var/run/dbus /root/.vnc /home/${USERNAME}/.vnc \
	&& touch /root/.Xmodmap /home/${USERNAME}/.Xmodmap \
	&& echo "${VNC_PASSWORD}" | tee /root/.vnc/passwd > /home/${USERNAME}/.vnc/passwd \
	&& chown -R ${USERNAME}:${USERNAME} /home/${USERNAME}/.Xmodmap /home/${USERNAME}/.fluxbox /home/${USERNAME}/.vnc \
	&& chmod +x /usr/local/share/init-dev-container.sh /usr/local/bin/set-resolution

ENTRYPOINT ["/usr/local/share/init-dev-container.sh"]
CMD ["sleep", "infinity"]
