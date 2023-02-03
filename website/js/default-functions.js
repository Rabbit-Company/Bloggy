var get = window.location.search.substr(1).split("&");

if('serviceWorker' in navigator) {
	window.addEventListener('load', () => {
		navigator.serviceWorker.register('/service-worker.js');
	});
}

function hide(element){
	document.getElementById(element).style.visibility = 'hidden';
}

function show(element){
	document.getElementById(element).style.visibility = 'visible';
}

function isHidden(element){
	return (document.getElementById(element).style.visibility == 'hidden');
}

function setText(element, text){
	document.getElementById(element).innerText = text;
}

function setHTML(element, html){
	document.getElementById(element).innerHTML = html;
}

function isEmailValid(mail){
	return new RegExp(/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*$/).test(mail);
}

function isPostValid(id){
	return Object.keys(POSTS).includes(id);
}

function isTagValid(tag){
	for(let i = 0; i < Object.keys(POSTS).length; i++){
		if(POSTS[Object.keys(POSTS)[i]].tag === tag) return true;
	}
	return false;
}