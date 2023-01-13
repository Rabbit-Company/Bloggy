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
	return Object.keys(posts).includes(id);
}

function isTagValid(tag){
	for(let i = 0; i < Object.keys(posts).length; i++){
		if(posts[Object.keys(posts)[i]].tag === tag) return true;
	}
	return false;
}