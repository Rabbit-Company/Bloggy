function displayPosts(amount = 9){
	let counter = 0;
	let html = "";
	postIDs.forEach(key => {
		if(counter >= amount) return;
		let avatar = CDN + "/avatars/" + USERNAME;
		let picture = (POSTS[key].picture.startsWith('http')) ? POSTS[key].picture : CDN + "/posts/" + USERNAME + "/" + POSTS[key].picture;
		let location = "/creator/" + USERNAME + "/" + key;
		html += "<div class='flex flex-col overflow-hidden rounded-lg shadow-lg'><div class='flex-shrink-0'><img class='h-48 w-full object-cover' loading='lazy' src='" + picture + "' alt='" + POSTS[key].title + "'></div><div class='flex flex-1 flex-col justify-between bg-white p-6'><div class='flex-1'><p class='text-sm font-medium text-indigo-600'><a href='/creator/" + USERNAME + "?tag=" + POSTS[key].tag.replaceAll(" ", "_") + "' class='hover:underline'>" + POSTS[key].tag + "</a></p><a href='" + location + "' class='mt-2 block'><p class='text-xl font-semibold text-gray-900'>" + POSTS[key].title + "</p><p class='mt-3 text-base text-gray-500'>" + POSTS[key].description + "</p></a></div><div class='mt-6 flex items-center'><div class='flex-shrink-0'><a href='/creator/" + USERNAME + "'><span class='sr-only'>" + AUTHOR + "</span><img class='h-10 w-10 rounded-full' loading='lazy' src='" + avatar + "' alt='" + AUTHOR + "'></a></div><div class='ml-3'><p class='text-sm font-medium text-gray-900'><a href='/creator/" + USERNAME + "' class='hover:underline'>" + AUTHOR + "</a></p><div class='flex space-x-1 text-sm text-gray-500'><time datetime='" + POSTS[key].date + "'>" + POSTS[key].date + "</time><span aria-hidden='true'>&middot;</span><span>" + POSTS[key].read + " min read</span></div></div></div></div></div>";
		counter++;
	});
	setHTML("post", html);
}

function changePostArray(method = "tag", target){
	let newPostArray = [];
	postIDs.forEach(key => {
		if(method !== "search" && POSTS[key][method] !== target) return;
		if(method === "search"){
			target = target.toLowerCase();
			let title = POSTS[key].title.toLowerCase();
			let tag = POSTS[key].tag.toLowerCase();
			let keywords = POSTS[key].keywords;
			if(!title.includes(target) && !tag.includes(target) && !keywords.includes(target)) return;
		}
		newPostArray.push(key);
	});

	postIDs = newPostArray;
	lastPostIndex = (postIDs.length - 10 < 0) ? (postIDs.length - 1) : 8;
}

let postIDs = Object.keys(POSTS).reverse();
let lastPostIndex = (postIDs.length - 10 < 0) ? (postIDs.length - 1) : 8;

let providedTag = get[0].replaceAll("tag=", "").replaceAll("_", " ");
let providedSearch = get[0].replaceAll("search=", "").replaceAll("_", " ");
if(get[0].includes("tag=") && isTagValid(providedTag)){
	changePostArray("tag", providedTag);
	displayPosts();
}else if(get[0].includes("search=")){
	document.getElementById("search").value = providedSearch;
	if(providedSearch != "") changePostArray("search", providedSearch);
	displayPosts();
}

function loadMorePosts(amount = 9){
	for(let i = 1; i <= amount; i++){
		if(lastPostIndex + 1 >= postIDs.length) break;
		let key = postIDs[lastPostIndex+1];
		let avatar = CDN + "/avatars/" + USERNAME;
		let picture = (POSTS[key].picture.startsWith('http')) ? POSTS[key].picture : CDN + "/posts/" + USERNAME + "/" + POSTS[key].picture;
		let location = "/creator/" + USERNAME + "/" + key;
		document.getElementById("post").innerHTML += "<div class='flex flex-col overflow-hidden rounded-lg shadow-lg'><div class='flex-shrink-0'><img class='h-48 w-full object-cover' loading='lazy' src='" + picture + "' alt='" + POSTS[key].title + "'></div><div class='flex flex-1 flex-col justify-between bg-white p-6'><div class='flex-1'><p class='text-sm font-medium text-indigo-600'><a href='/creator/" + USERNAME + "?tag=" + POSTS[key].tag.replace(" ", "_") + "' class='hover:underline'>" + POSTS[key].tag + "</a></p><a href='" + location + "' class='mt-2 block'><p class='text-xl font-semibold text-gray-900'>" + POSTS[key].title + "</p><p class='mt-3 text-base text-gray-500'>" + POSTS[key].description + "</p></a></div><div class='mt-6 flex items-center'><div class='flex-shrink-0'><a href='/creator/" + USERNAME + "'><span class='sr-only'>" + AUTHOR + "</span><img class='h-10 w-10 rounded-full' loading='lazy' src='" + avatar + "' alt='" + AUTHOR + "'></a></div><div class='ml-3'><p class='text-sm font-medium text-gray-900'><a href='/creator/" + USERNAME + "' class='hover:underline'>" + AUTHOR + "</a></p><div class='flex space-x-1 text-sm text-gray-500'><time datetime='" + POSTS[key].date + "'>" + POSTS[key].date + "</time><span aria-hidden='true'>&middot;</span><span>" + POSTS[key].read + " min read</span></div></div></div></div></div>";
		lastPostIndex++;
	}
}

// Infinite scroll
window.addEventListener('scroll', () => {
	if(window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - (document.documentElement.scrollHeight / 10)) loadMorePosts();
});

document.getElementById("search").addEventListener("keypress", (event) => {
	if (event.key !== "Enter") return;
	event.preventDefault();
	window.location.assign("?search=" + document.getElementById("search").value.replaceAll(" ", "_"));
});