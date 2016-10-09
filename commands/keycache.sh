#!/bin/bash

if [ -d ~/tmpgit ] ; then
	exit
fi

echo -e '\n\n\ncaching SSH and GPG keys\n'

eval "$(ssh-agent)"
ssh-add ~/.ssh/id_rsa

if [ -f ~/.gnupg/gpg-agent.conf ] ; then
	mv ~/.gnupg/gpg-agent.conf ~/.gnupg/gpg-agent.conf.bak
fi
cat > ~/.gnupg/gpg-agent.conf <<- EOM
	default-cache-ttl 34560000
	max-cache-ttl 34560000
EOM
gpg-connect-agent reloadagent /bye
rm ~/.gnupg/gpg-agent.conf
if [ -f ~/.gnupg/gpg-agent.conf.bak ] ; then
	mv ~/.gnupg/gpg-agent.conf.bak ~/.gnupg/gpg-agent.conf
fi

mkdir ~/tmpgit
cd ~/tmpgit
git init
touch balls
git add balls
git commit -S -a -m test

if [ ! -f ~/.ssh/id_rsa_docker ] ; then
	ssh-keygen -t rsa -b 4096 -C 'gibson@docker' -P '' -f ~/.ssh/id_rsa_docker
	echo -e '\n\nGive this public key access to WordPress and then hit enter to continue:\n'
	cat ~/.ssh/id_rsa_docker.pub
	read
	sleep 30
fi